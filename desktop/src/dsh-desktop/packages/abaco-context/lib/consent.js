/**
 * Principle C state machine: first compaction of a session asks; after accept
 * it is automatic; a reject does not compact and does not re-ask on every
 * pre-step (anti-loop). The next ask happens only on a later threshold
 * crossing, after usage has dropped back under the bar.
 *
 * The flag lives in Layer 2 session document `meta.compactionConsent` so it
 * survives the compaction it is gating.
 *
 * @module abaco-context/lib/consent
 */

/** Fresh session: never asked. */
export const CONSENT_UNSET = 'unset'

/** User accepted: automatic for the rest of this session. */
export const CONSENT_ALLOWED = 'allowed'

/** User rejected this crossing; do not compact; re-arm only after a drop. */
export const CONSENT_REJECTED = 'rejected'

/** Soft-warn copy after a reject. Never a second UI prompt on the same crossing. */
export const REJECT_SOFT_WARN =
  'abaco-compaction: first compaction declined; the window stays intact. Will ask again only the next time usage crosses the 0.90 threshold.'

/**
 * Normalize a stored consent record.
 *
 * @param raw - anything read from disk.
 * @returns `{ state, armed }`.
 */
export function normalizeConsent(raw) {
  if (raw === CONSENT_ALLOWED || raw === 'accepted' || raw === true) {
    return { state: CONSENT_ALLOWED, armed: true }
  }
  if (raw === CONSENT_REJECTED || raw === false) {
    return { state: CONSENT_REJECTED, armed: false }
  }
  if (raw !== null && typeof raw === 'object') {
    const state =
      raw.state === CONSENT_ALLOWED || raw.state === CONSENT_REJECTED || raw.state === CONSENT_UNSET
        ? raw.state
        : CONSENT_UNSET
    return { state, armed: raw.armed !== false }
  }
  return { state: CONSENT_UNSET, armed: true }
}

/**
 * Decide what to do at one pre-step / overflow probe.
 *
 * @param consent - current flag.
 * @param crossing - `{ wouldCompact, unknown? }`.
 * @returns `{ action: 'allow'|'ask'|'skip'|'pass', next, warn }`.
 */
export function nextConsentAction(consent, crossing) {
  const current = normalizeConsent(consent)
  if (crossing?.unknown === true) {
    return { action: 'pass', next: current, warn: false }
  }
  if (crossing?.wouldCompact !== true) {
    if (current.state === CONSENT_REJECTED && current.armed === false) {
      return { action: 'skip', next: { state: CONSENT_REJECTED, armed: true }, warn: false }
    }
    return { action: 'skip', next: current, warn: false }
  }
  if (current.state === CONSENT_ALLOWED) {
    return { action: 'allow', next: current, warn: false }
  }
  if (current.state === CONSENT_REJECTED && current.armed === false) {
    return { action: 'skip', next: current, warn: true }
  }
  return { action: 'ask', next: current, warn: false }
}

/**
 * Fold an approval outcome into the next flag.
 *
 * `'allowed-once'` is the only grant (`dsh-user-approval`). Everything else
 * — reject, cancel, unavailable — is a decline: do not compact, arm the
 * anti-loop so the next pre-step does not ask again.
 *
 * @param _consent - previous flag (unused; outcome replaces it).
 * @param outcome - an {@link ApprovalOutcome} or a test stand-in.
 * @returns the next flag.
 */
export function applyConsentOutcome(_consent, outcome) {
  if (outcome === 'allowed-once' || outcome === 'allowed' || outcome === true) {
    return { state: CONSENT_ALLOWED, armed: true }
  }
  return { state: CONSENT_REJECTED, armed: false }
}

/**
 * Probe whether this step would compact, without calling the engine.
 *
 * Unknown measurements pass through so a missing meter cannot become a
 * confirmation loop on every pre-step of a short session.
 *
 * @param engine - the live `compaction` service.
 * @param agent - the agent about to step.
 * @param trigger - `'pressure'` or `'context-overflow'`.
 * @returns `{ wouldCompact, unknown, used, thresholdTokens, retainTokens, contextWindow, thresholdRatio, retainRatio }`.
 */
export function probeCrossing(engine, agent, trigger) {
  const thresholdRatio =
    Number.isFinite(engine?.config?.thresholdRatio) && engine.config.thresholdRatio > 0
      ? engine.config.thresholdRatio
      : 0.9
  const retainRatio =
    Number.isFinite(engine?.config?.retainRatio) && engine.config.retainRatio > 0
      ? engine.config.retainRatio
      : 0.12
  let used = null
  let contextWindow = null
  try {
    const measurement = engine?.ctx?.tokenMeter?.measure?.(agent?.session)
    if (Number.isFinite(measurement?.totalTokens)) used = measurement.totalTokens
    if (Number.isFinite(measurement?.contextWindow)) contextWindow = measurement.contextWindow
  } catch {
    // A meter that throws is reported as unknown, never as a fake zero.
  }
  const window = Number.isFinite(contextWindow) ? contextWindow : 1_000_000
  const thresholdTokens = Math.floor(window * thresholdRatio)
  const retainTokens = Math.floor(window * retainRatio)
  if (trigger === 'context-overflow') {
    return {
      wouldCompact: true,
      unknown: false,
      used,
      thresholdTokens,
      retainTokens,
      contextWindow: window,
      thresholdRatio,
      retainRatio
    }
  }
  if (used === null) {
    return {
      wouldCompact: false,
      unknown: true,
      used,
      thresholdTokens,
      retainTokens,
      contextWindow: window,
      thresholdRatio,
      retainRatio
    }
  }
  return {
    wouldCompact: used >= thresholdTokens,
    unknown: false,
    used,
    thresholdTokens,
    retainTokens,
    contextWindow: window,
    thresholdRatio,
    retainRatio
  }
}

/**
 * Run Principle C around one `compactIfNeeded` call.
 *
 * @param options - `{ compact, agent, trigger, signal, hooks }`.
 * @returns whatever `compact` returned, or `null` when C blocked the run.
 */
export async function guardedCompactIfNeeded(options) {
  const { compact, agent, trigger, signal, hooks } = options
  const crossing = typeof hooks.probe === 'function' ? await hooks.probe(agent, trigger, signal) : { wouldCompact: true }
  const consent = typeof hooks.readConsent === 'function' ? await hooks.readConsent(agent) : { state: CONSENT_UNSET, armed: true }
  const decision = nextConsentAction(consent, crossing)

  if (decision.action === 'pass') {
    return compact(agent, trigger, signal)
  }

  if (decision.action === 'skip') {
    if (decision.warn) hooks.warn?.(REJECT_SOFT_WARN)
    if (typeof hooks.writeConsent === 'function') await hooks.writeConsent(agent, decision.next)
    hooks.telemetry?.({
      event: 'compaction_consent',
      action: 'skip',
      state: decision.next.state,
      trigger,
      sessionId: sessionIdOf(agent),
      used_before: crossing.used ?? null,
      thresholdTokens: crossing.thresholdTokens ?? null,
      retainTokens: crossing.retainTokens ?? null
    })
    return null
  }

  if (decision.action === 'ask') {
    const outcome = await hooks.ask(agent, signal)
    const next = applyConsentOutcome(decision.next, outcome)
    if (typeof hooks.writeConsent === 'function') await hooks.writeConsent(agent, next)
    if (next.state !== CONSENT_ALLOWED) {
      hooks.warn?.(REJECT_SOFT_WARN)
      hooks.telemetry?.({
        event: 'compaction_consent',
        action: 'rejected',
        outcome: String(outcome),
        trigger,
        sessionId: sessionIdOf(agent),
        used_before: crossing.used ?? null,
        thresholdTokens: crossing.thresholdTokens ?? null,
        retainTokens: crossing.retainTokens ?? null
      })
      return null
    }
    hooks.telemetry?.({
      event: 'compaction_consent',
      action: 'accepted',
      outcome: String(outcome),
      trigger,
      sessionId: sessionIdOf(agent),
      used_before: crossing.used ?? null,
      thresholdTokens: crossing.thresholdTokens ?? null,
      retainTokens: crossing.retainTokens ?? null
    })
  }

  try {
    await hooks.persistBeforeCompact?.(agent)
  } catch (error) {
    hooks.warn?.(`abaco-compaction: persist-before-compact failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  const result = await compact(agent, trigger, signal)
  hooks.telemetry?.({
    event: 'compaction_guard',
    action: result === null || result === undefined ? 'no-op' : 'compacted',
    trigger,
    sessionId: sessionIdOf(agent),
    used_before: crossing.used ?? null,
    thresholdTokens: crossing.thresholdTokens ?? null,
    retainTokens: crossing.retainTokens ?? null
  })
  return result
}

function sessionIdOf(agent) {
  const id = agent?.session?.header?.id ?? agent?.session?.id
  return typeof id === 'string' ? id : null
}
