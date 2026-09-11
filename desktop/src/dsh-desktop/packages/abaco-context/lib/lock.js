/**
 * Owner-locked compaction policy for ABACO DEEP HARNES.
 *
 * These three numbers are a LOCK, not a default and not a suggestion. They
 * come from `docs/SPEC-CONTEXT-3-LAYERS.md` §8 and
 * `docs/CONTRACT-MEMORY-3PHASE-SPILL-CD.md` §0:
 *
 *   thresholdRatio  0.90   hard fire — not stock 0.80, not the dead 0.60 file
 *   retainRatio     0.12   verbatim tail; MUST be < thresholdRatio
 *   maxTokens       8192   summarizer budget
 *
 * Only ratios. An absolute `retainTokens` is forbidden: it is validated per
 * routed model and silently disables compaction on a smaller window.
 *
 * If something in the engine prevents 0.90 from being safe, report it with
 * evidence. Do not lower the threshold to 0.80 without asking Leader.
 *
 * @module abaco-context/lib/lock
 */

/** Hard fire: compact at 90% of the routed window. */
export const THRESHOLD_RATIO = 0.9

/** Verbatim tail as a fraction of the routed window. Must be < {@link THRESHOLD_RATIO}. */
export const RETAIN_RATIO = 0.12

/** Summarizer token budget. */
export const MAX_TOKENS = 8192

/** Automatic between-step compaction. */
export const AUTO = true

/**
 * The frozen lock object. `thresholdRatio` is the JS number `0.9`, which is
 * the same value YAML writes as `0.90`.
 */
export const ABACO_COMPACTION_LOCK = Object.freeze({
  thresholdRatio: THRESHOLD_RATIO,
  retainRatio: RETAIN_RATIO,
  maxTokens: MAX_TOKENS,
  auto: AUTO
})

/** Dead values that must never reappear as the live policy. */
export const DEAD_POLICIES = Object.freeze({
  stock: Object.freeze({ thresholdRatio: 0.8, retainRatio: 0.16 }),
  discardedPreset: Object.freeze({ thresholdRatio: 0.6, retainRatio: 0.08, maxTokens: 16384 })
})

/**
 * Whether a composed policy still matches the lock.
 *
 * @param policy - `{ thresholdRatio, retainRatio, maxTokens, retainTokens? }`.
 * @returns true when the live numbers are the lock and there is no absolute retain.
 */
export function matchesLock(policy) {
  if (policy === null || typeof policy !== 'object') return false
  if (policy.thresholdRatio !== THRESHOLD_RATIO) return false
  if (policy.retainRatio !== RETAIN_RATIO) return false
  if (policy.maxTokens !== undefined && policy.maxTokens !== MAX_TOKENS) return false
  if (policy.retainTokens !== undefined && policy.retainTokens !== null) return false
  return RETAIN_RATIO < THRESHOLD_RATIO
}

/**
 * Alerts for a policy document that drifted off the lock.
 *
 * @param policy - a composed policy, or `undefined`.
 * @returns a list of stable alert codes; empty when the lock holds.
 */
export function lockAlerts(policy) {
  const alerts = []
  if (policy === null || typeof policy !== 'object') {
    alerts.push('policy-lock-missing')
    return alerts
  }
  if (policy.thresholdRatio !== THRESHOLD_RATIO) alerts.push('policy-lock-threshold')
  if (policy.retainRatio !== RETAIN_RATIO) alerts.push('policy-lock-retain')
  if (policy.maxTokens !== undefined && policy.maxTokens !== MAX_TOKENS) alerts.push('policy-lock-max-tokens')
  if (policy.retainTokens !== undefined && policy.retainTokens !== null) alerts.push('policy-lock-retain-tokens')
  if (
    typeof policy.retainRatio === 'number' &&
    typeof policy.thresholdRatio === 'number' &&
    policy.retainRatio >= policy.thresholdRatio
  ) {
    alerts.push('policy-ratio-invalid')
  }
  return alerts
}

/**
 * Throw when a policy is not the lock. Used by tests so a silent edit of the
 * preset numbers fails in the repo, not in the owner's app.
 *
 * @param policy - a composed policy.
 */
export function assertLockPolicy(policy) {
  const alerts = lockAlerts(policy)
  if (alerts.length > 0) {
    throw new Error(
      `ABACO compaction lock violated (${alerts.join(', ')}): expected thresholdRatio ${THRESHOLD_RATIO}, retainRatio ${RETAIN_RATIO}, maxTokens ${MAX_TOKENS}, no retainTokens; got ${JSON.stringify(policy)}`
    )
  }
}
