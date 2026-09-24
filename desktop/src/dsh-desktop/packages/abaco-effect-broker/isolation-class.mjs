/**
 * INV-ISOLATION-CLASS (Ola 2 Bloque 2.B)
 *
 * Isolation table for tip-of-spear. Market / Cordis community plugins MUST NOT
 * default to same-process main. Allowed market classes: UtilityProcess or the
 * F1 strangler-fork cell (mediacion-pilot). Missing / in-process → fail-closed
 * deny unless the lab flag is set.
 *
 * Lab flag (tests / explicit lab only): ABACO_LAB_ALLOW_INPROCESS_MARKET=1
 * Jev / Atena never grant an isolation widen.
 *
 * @module abaco-effect-broker/isolation-class
 */

/** @typedef {'in-process' | 'subprocess' | 'utility-process' | 'strangler-fork' | 'deny'} IsolationClass */
/** @typedef {'face' | 'provider-high' | 'f1-pilot' | 'market' | 'host-pinned'} IsolationKind */

/**
 * Frozen INV-ISOLATION-CLASS table (piloto + market gate).
 * @type {ReadonlyArray<{ kind: IsolationKind, isolation: IsolationClass, owner: string, notes: string }>}
 */
export const ISOLATION_CLASS_TABLE = Object.freeze([
  Object.freeze({
    kind: 'face',
    isolation: 'in-process',
    owner: 'python-core faces; Desk UI',
    notes: 'FacePlugin TCB; revoke zeros caps metadata; digest pin on execute',
  }),
  Object.freeze({
    kind: 'provider-high',
    isolation: 'subprocess',
    owner: 'python-core Phase S',
    notes: 'High-risk providers only; env allowlist; kill+drain',
  }),
  Object.freeze({
    kind: 'f1-pilot',
    isolation: 'utility-process',
    owner: 'abaco-mediacion-pilot',
    notes: 'Honest strangler-fork cell until Electron main spawns UtilityProcess worker IPC',
  }),
  Object.freeze({
    kind: 'market',
    isolation: 'deny',
    owner: 'abaco-effect-broker isolation-class (Ola 2.B)',
    notes:
      'Market/Cordis community MUST use utility-process or strangler-fork; in-process default is fail-closed deny',
  }),
  Object.freeze({
    kind: 'host-pinned',
    isolation: 'in-process',
    owner: 'pinned MANIFEST_CAPS / PATCH_ENABLED',
    notes: 'First-party pinned plugins only; not a market path',
  }),
])

/** Isolation classes that satisfy the market gate. */
export const MARKET_ALLOWED_ISOLATION = Object.freeze([
  'utility-process',
  'strangler-fork',
])

/** Env lab escape — never implied by advisors. */
export const LAB_ALLOW_INPROCESS_MARKET_ENV = 'ABACO_LAB_ALLOW_INPROCESS_MARKET'

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
export function isLabInprocessMarketAllowed(env = process.env) {
  const raw = String((env && env[LAB_ALLOW_INPROCESS_MARKET_ENV]) || '')
    .trim()
    .toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
}

/**
 * Normalize isolation class tokens.
 * @param {unknown} value
 * @returns {IsolationClass | null}
 */
export function normalizeIsolationClass(value) {
  if (value == null || value === '') return null
  const v = String(value).trim().toLowerCase().replace(/_/g, '-')
  if (v === 'in-process' || v === 'inprocess' || v === 'same-process') return 'in-process'
  if (v === 'subprocess' || v === 'sandbox') return 'subprocess'
  if (v === 'utility-process' || v === 'utilityprocess' || v === 'utility') return 'utility-process'
  if (v === 'strangler-fork' || v === 'strangler' || v === 'strangler-fork-cell') {
    return 'strangler-fork'
  }
  if (v === 'deny' || v === 'fail-closed') return 'deny'
  return null
}

/**
 * Resolve table row for a kind.
 * @param {IsolationKind | string} kind
 */
export function isolationRowFor(kind) {
  const k = String(kind || '').trim().toLowerCase()
  return ISOLATION_CLASS_TABLE.find((row) => row.kind === k) || null
}

/**
 * Detect market origin from authorize / load request fields.
 * Explicit only — does not infer market from cordis.host alone (host-pinned
 * fibers also use that channel).
 * @param {object | null | undefined} req
 * @returns {boolean}
 */
export function isMarketOrigin(req) {
  if (!req || typeof req !== 'object') return false
  const origin = String(req.origin || req.plugin_origin || '').trim().toLowerCase()
  if (origin === 'market' || origin === 'cordis-market' || origin === 'dshmarket') return true
  const channel = req.channel && typeof req.channel === 'object' ? req.channel : null
  if (channel) {
    const chOrigin = String(channel.origin || '').trim().toLowerCase()
    if (chOrigin === 'market' || chOrigin === 'cordis-market' || chOrigin === 'dshmarket') {
      return true
    }
    if (channel.market === true) return true
  }
  if (req.market === true) return true
  return false
}

/**
 * Resolve the isolation class claimed for this request.
 * @param {object | null | undefined} req
 * @returns {IsolationClass | null}
 */
export function claimedIsolationClass(req) {
  if (!req || typeof req !== 'object') return null
  const direct =
    req.isolation_class ||
    req.isolationClass ||
    (req.channel && (req.channel.isolation_class || req.channel.isolationClass)) ||
    null
  return normalizeIsolationClass(direct)
}

/**
 * Market gate: UtilityProcess / strangler-fork, or fail-closed deny.
 * In-process is refused unless the lab flag is set.
 *
 * @param {{
 *   origin?: string,
 *   isolationClass?: unknown,
 *   market?: boolean,
 *   env?: NodeJS.ProcessEnv,
 * }} [input]
 * @returns {{ ok: true, isolation: IsolationClass, lab: boolean } | { ok: false, reason: string, isolation: IsolationClass | null, lab: boolean }}
 */
export function assertMarketIsolation(input = {}) {
  const env = input.env || process.env
  const lab = isLabInprocessMarketAllowed(env)
  const isolation = normalizeIsolationClass(input.isolationClass)

  const treatedAsMarket =
    input.market === true ||
    ['market', 'cordis-market', 'dshmarket'].includes(
      String(input.origin || '')
        .trim()
        .toLowerCase(),
    )

  if (!treatedAsMarket) {
    return { ok: true, isolation: isolation || 'in-process', lab }
  }

  if (isolation && MARKET_ALLOWED_ISOLATION.includes(isolation)) {
    return { ok: true, isolation, lab }
  }

  if (isolation === 'in-process' || isolation == null) {
    if (lab) {
      return { ok: true, isolation: isolation || 'in-process', lab: true }
    }
    return {
      ok: false,
      reason: 'market-in-process-denied',
      isolation: isolation,
      lab: false,
    }
  }

  return {
    ok: false,
    reason: 'market-isolation-denied',
    isolation,
    lab: false,
  }
}

/**
 * Authorize-path helper: if the request is market-origin, enforce the gate.
 * @param {object | null | undefined} req
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function gateAuthorizeIsolation(req, env = process.env) {
  if (!isMarketOrigin(req)) return { ok: true }
  const result = assertMarketIsolation({
    market: true,
    origin: 'market',
    isolationClass: claimedIsolationClass(req),
    env,
  })
  if (result.ok) return { ok: true }
  return { ok: false, reason: result.reason }
}

/**
 * Load-time helper for market installer / Cordis composition.
 * Prefer calling this before same-process `apply()` of a community plugin.
 * @param {{ isolationClass?: unknown, env?: NodeJS.ProcessEnv }} [input]
 */
export function admitMarketPluginLoad(input = {}) {
  return assertMarketIsolation({
    market: true,
    origin: 'market',
    isolationClass: input.isolationClass,
    env: input.env,
  })
}

/** Marker kept in product code for INV-12 CI (INV-ISOLATION-CLASS). */
export const INV_ISOLATION_CLASS = 'INV-ISOLATION-CLASS'
