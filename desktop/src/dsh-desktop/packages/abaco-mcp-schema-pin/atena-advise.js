/**
 * Atena (asesor) — F1.5 advisory stub.
 *
 * NEVER imported by `index.js` (pin/verify/wrap) and NEVER imported by
 * `abaco-effect-broker` `authorize()`. Janice = runtime. Atena may only
 * propose; it cannot pin, witness, allow, or deny.
 *
 * @module abaco-mcp-schema-pin/atena-advise
 */

/** Closed set of advisory actions. None of these execute a sink. */
export const ATENA_ACTIONS = Object.freeze(['observe', 'review', 'none'])

/**
 * Pure advisory. Does not touch the pin store, audit, or tools registry.
 *
 * @param {{ publicName?: string, reason?: string, expansion?: boolean }} _finding
 * @returns {{ action: string, note: string }}
 */
export function atenaAdvise(_finding) {
  return {
    action: 'observe',
    note: 'Atena asesor only — not in authorize, not in pin/verify hot-path.',
  }
}
