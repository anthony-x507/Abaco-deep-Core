/**
 * Reading the two ways Electron reports a preload that failed to load.
 *
 * A sandboxed preload that throws while loading does not break the window: the
 * page still renders, every control still paints, and the only symptom is that
 * the `contextBridge` surfaces the UI calls are simply absent. The folder picker
 * answers "DSH Desktop directory picker bridge is unavailable", the embedded
 * browser strip never appears, and nothing is written anywhere. That is how one
 * fatal `require` line in `out/preload/index.cjs` could stop the owner from
 * creating a single workspace without leaving a trace to follow.
 *
 * Electron reports the failure twice, and both reports were being dropped:
 *
 * - `webContents.on('preload-error', (event, preloadPath, error) => ...)` fires
 *   once per failed preload, and nothing was listening for it.
 * - The same failure also arrives as a `console-message` with `level: 'error'`,
 *   but attributed to the sandbox bundle rather than to the harness page, so the
 *   `http://127.0.0.1:` filter in `src/main/index.ts` discarded it.
 *
 * Both shapes below were measured on Electron 43.4.0 by loading a deliberately
 * broken sandboxed preload (`require('./chunk.cjs')`) into a hidden
 * BrowserWindow with `sandbox: true`:
 *
 * ```
 * CONSOLE level=error sourceId=node:electron/js2c/sandbox_bundle
 *         message=Unable to load preload script: /private/tmp/.../preload-bug.cjs
 * CONSOLE level=error sourceId=node:electron/js2c/sandbox_bundle
 *         message=Error: module not found: ./chunk.cjs
 * PRELOAD_ERROR path=preload-bug.cjs message=module not found: ./chunk.cjs
 * EXEC typeof window.probeBridge -> undefined      (the control preload: 'object')
 * ```
 *
 * This module is pure so the decision that used to be an inline
 * `startsWith('http://127.0.0.1:')` check can be tested without a BrowserWindow.
 */

/** The `details` Electron passes to a `console-message` listener. */
export interface ConsoleMessageDetails {
  level: string
  message: string
  sourceId?: string
}

/**
 * Where output from inside a *sandboxed preload* is attributed.
 *
 * Verified on Electron 43.4.0: the resolver that failed lives in
 * `node:electron/js2c/sandbox_bundle`, and every preload diagnostic — the
 * "Unable to load preload script" notice, the thrown error, and the renderer
 * security warning — is reported under that `sourceId`. It is deliberately not
 * the harness page URL, which is exactly why the page filter dropped it.
 */
export const SANDBOX_PRELOAD_SOURCE_ID = 'node:electron/js2c/sandbox_bundle'

/** Electron's own wording when it gives up on a preload script. */
const PRELOAD_LOAD_FAILURE_NOTICE = 'Unable to load preload script:'

/**
 * A relative `require` inside a sandboxed preload fails with Electron's
 * `module not found: <specifier>`; the specifier is relative when the bundler
 * left a cross-module `require` in place instead of inlining it.
 */
const RELATIVE_MODULE_NOT_FOUND = /module not found:\s*([./][^\s'"]*)/

export type ConsoleMessageDecision = 'ignore' | 'preload-failure' | 'renderer-plugin-failure'

/**
 * Whether a `console-message` came from a preload that failed to load.
 *
 * The level check is load-bearing: a healthy sandboxed preload still reports the
 * usual Chromium security warning under the very same `sourceId`, and that one
 * arrives as `level=warning`.
 */
export function isPreloadFailureMessage(details: ConsoleMessageDetails): boolean {
  if (details.level !== 'error') return false
  if (details.sourceId === SANDBOX_PRELOAD_SOURCE_ID) return true
  return details.message.startsWith(PRELOAD_LOAD_FAILURE_NOTICE)
}

/**
 * Sort one `console-message` into the log that should receive it.
 *
 * `pageSourceUrl` is the window's current URL, used the same way the previous
 * inline filter used it: as the fallback when a message carries no `sourceId`.
 * A preload failure is classified *before* the page filter, because its origin
 * is the sandbox bundle and the page filter would throw away the one error that
 * explains why the whole window has no bridges.
 */
export function classifyConsoleMessage(
  details: ConsoleMessageDetails,
  pageSourceUrl: string
): ConsoleMessageDecision {
  if (details.level !== 'error') return 'ignore'
  if (isPreloadFailureMessage(details)) return 'preload-failure'
  const sourceUrl = details.sourceId || pageSourceUrl
  if (!sourceUrl.startsWith('http://127.0.0.1:')) return 'ignore'
  return 'renderer-plugin-failure'
}

/**
 * A single, actionable line for the harness log.
 *
 * `origin` is whichever of the two reports is speaking: the preload's path from
 * `preload-error`, or the sandbox bundle's `sourceId` from `console-message`
 * (whose `message` already carries the path).
 */
export function describePreloadFailure(origin: string, error: unknown): string {
  const message = errorMessageOf(error)
  const relative = RELATIVE_MODULE_NOT_FOUND.exec(message)?.[1]
  const hint = relative
    ? ` A sandboxed preload can only require "electron", "events", "timers" and "url", so "${relative}"`
      + ' means the preload was not built self-contained — see the preload build in electron.vite.config.ts.'
    : ''
  return `preload failed to load (${origin}): ${message}.`
    + ' Every contextBridge surface of that window is missing until this is fixed.'
    + hint
}

/**
 * `preload-error` hands over an `Error`, but the value crosses a process
 * boundary, so accept anything that carries a `message` before falling back.
 */
function errorMessageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const { message } = error as { message?: unknown }
    if (typeof message === 'string') return message
  }
  try {
    return JSON.stringify(error) ?? String(error)
  } catch {
    return String(error)
  }
}
