/**
 * INV-DOWNGRADE-HITL companion — empty compatible_core deny for medium/high.
 *
 * Python Bind (`sandbox/versions.py`) is the primary consumer of
 * `compatible_core` on provider manifests. This module is the deep-side
 * portable predicate: medium/high effect sets must declare a non-empty
 * compatible_core / core-range string. Empty or missing = deny.
 *
 * Presentation-only `ui.slot` (and empty? no — empty effects = medium/high
 * fail-closed, same as INV-TTL-BOUNDED) requires an explicit range.
 *
 * @module abaco-effect-broker/compatible-core-policy
 */

/**
 * Medium/high for compatible_core policy: any effect beyond ui.slot-only.
 * Empty effect list = medium/high (fail-closed).
 * @param {string[] | undefined | null} effects
 */
export function effectsRequireCompatibleCore(effects) {
  const list = Array.isArray(effects) ? effects : []
  if (list.length === 0) return true
  return list.some((e) => e !== 'ui.slot')
}

/**
 * @param {unknown} compatibleCore  string range / spec from manifest
 * @param {string[] | undefined | null} effects
 * @returns {{ ok: true } | { ok: false, reason: 'compatible-core-empty' }}
 */
export function assertCompatibleCoreForMediumHigh(compatibleCore, effects) {
  if (!effectsRequireCompatibleCore(effects)) {
    return { ok: true }
  }
  const text =
    compatibleCore == null
      ? ''
      : typeof compatibleCore === 'string'
        ? compatibleCore.trim()
        : String(compatibleCore).trim()
  if (!text) {
    return { ok: false, reason: 'compatible-core-empty' }
  }
  return { ok: true }
}
