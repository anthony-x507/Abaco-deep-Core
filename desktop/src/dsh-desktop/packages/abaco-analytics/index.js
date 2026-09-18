/**
 * Host half for the browser-only Analytics settings page.
 *
 * Session numbers are collected in the renderer from the stock chat / projection
 * seats and shown under Settings → Analytics. Nothing is written to disk here,
 * and this row does not change engine behaviour.
 *
 * `exports["./lib/summary"]` is a Node ESM map only. It does not register
 * `./lib/summary.js` in the client module table — client.js must stay inlined.
 */
export const name = 'abaco-analytics'

export function apply() {}
