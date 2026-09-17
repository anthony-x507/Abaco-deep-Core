/**
 * F1 Effect Broker (Harness host).
 * authorize() is the ONLY path to protected sinks in the pilot scope.
 * Identity comes from ChannelIdentity — body plugin_id is ignored.
 * Cero Atena (asesor) en authorize. Janice = runtime (plugins) elsewhere.
 * @module abaco-effect-broker
 */

import { createHash, randomUUID } from 'node:crypto'
import { appendFile, mkdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  extractManifestCaps,
  canonicalManifestJson,
  manifestDigest,
} from './manifest-verify.mjs'
import { tierOf, isDisabled, DISABLED as TIERS_DISABLED_MIRROR } from './tiers.js'
import {
  state as breakerState,
  record as breakerRecord,
  resetForTests as resetBreakersForTests,
  LEVELS as BREAKER_LEVELS,
} from './breakers.js'
import {
  tag as provenanceTag,
  audit as provenanceAudit,
  verifyAudit as verifyProvenanceAudit,
  resetAuditForTests,
} from './provenance.js'
import {
  evaluate as cascadeEvaluate,
  getCascadeAudit,
  resetCascadeForTests,
} from './cascade.js'
import { sealLiveAdmission } from './admission.js'

export { resetAuditForTests as resetProvenanceAuditForTests }
export {
  buildAdmissionGraph,
  proposeAdmissionChange,
  proposeLiveAdmissionChange,
  getAdmissionGraph,
  getAdmissionChangeLog,
  resetAdmissionForTests,
  NON_CONTROL_SOURCES,
  CONTROL_SOURCES,
  SEALED_PRELOAD_KEYS,
  ADMISSION_ROLES,
  ADMISSION_ACTIONS,
} from './admission.js'

/** @typedef {'host'|'user'|'plugin-data'|'untrusted'} TrustLabel */
/** @typedef {'ui.slot'|'host.fetch'|'tool.call'|'tool.register'|'ipc.invoke'|'fs.read'|'fs.write'|'net.fetch'|'proc.spawn'|'grant.mutate'|'compose.mutate'} EffectKind */

const TRUST_RANK = { untrusted: 0, 'plugin-data': 1, user: 2, host: 3 }
/** Rank → label, same order as TRUST_RANK (P2 provenance: do not reorder). */
const TRUST_LABELS = ['untrusted', 'plugin-data', 'user', 'host']

/* ------------------------------------------------------------------ */
/* F2 — integración (W6).                                              */
/*                                                                     */
/* G0 (este broker, authorize) mantiene la ÚLTIMA PALABRA: las cuatro  */
/* consultas F2 solo pueden DENEGAR o marcar; ninguna puede convertir  */
/* un deny en allow. Deny-by-default en todo el camino. La lógica      */
/* P1/P2/P3 de F1 no se tocó: lo F2 es aditivo (campos `f2` en audit,  */
/* razones nuevas solo en escenarios nuevos).                          */
/*                                                                     */
/* Decisiones documentadas (brief W6):                                 */
/* (a) Mapeo de ordinales F1 (4 niveles) ↔ F2 (6 niveles): el `host` de */
/*     F1 equivale a `system` de F2 — ambos son el harness host (TCB),  */
/*     tope de su escala. deriveChannelTrust() nunca emite              */
/*     guardian/developer en pilot, así que el mapeo es total y        */
/*     monótono: min(claim, channel) da el mismo resultado en ambas     */
/*     escalas. La verificación cruzada `provenance-drift` falla       */
/*     cerrada si alguna vez divergen.                                 */
/* (b) DISABLED_PLUGINS (este archivo) es la FUENTE ÚNICA;             */
/*     tiers.DISABLED es un espejo verificado (assert al importar +     */
/*     test de igualdad de sets).                                      */
/* (c) humanApproval = flag EXPLÍCITO en la señal                      */
/*     (req.human_approval). Solo se honra si el canal atestigua trust  */
/*     'host' (F2: 'system'); en pilot ningún canal lo atestigua, así   */
/*     que la flag se ignora y se audita. Quién está autorizado a       */
/*     emitirla es decisión pendiente del líder.                        */
/* (d) El audit de la cascada se reenvía al hash-chain de              */
/*     provenance.audit() vía forwardCascadeAudit() (idempotente).      */
/* ------------------------------------------------------------------ */

/** Decisión (a): F1→F2. `host` (F1) ↔ `system` (F2). */
export const F1_TO_F2_TRUST = Object.freeze({
  untrusted: 'untrusted',
  'plugin-data': 'plugin-data',
  user: 'user',
  host: 'system',
})
/** Decisión (a): F2→F1 (inverso parcial; guardian/developer no existen en F1). */
export const F2_TO_F1_TRUST = Object.freeze({
  untrusted: 'untrusted',
  'plugin-data': 'plugin-data',
  user: 'user',
  system: 'host',
})

/** Disabled set — rehab = FAIL. */
export const DISABLED_PLUGINS = new Set([
  'abaco-brand',
  'abaco-device-identity',
  'abaco-cloud-sync',
  'abaco-onboarding',
  'abaco-experimental',
])

// Decisión (b): DISABLED_PLUGINS es la FUENTE ÚNICA; tiers.DISABLED es un
// espejo verificado. Falla cerrado al importar si divergen (rehab = FAIL).
for (const id of TIERS_DISABLED_MIRROR) {
  if (!DISABLED_PLUGINS.has(id)) {
    throw new Error(`broker/tiers disabled-set drift: tiers lists ${id}, broker does not`)
  }
}
for (const id of DISABLED_PLUGINS) {
  if (!TIERS_DISABLED_MIRROR.has(id)) {
    throw new Error(`broker/tiers disabled-set drift: broker lists ${id}, tiers does not`)
  }
}

/** Patch-enabled ids for F1 A_plugin (structural stub + real enabled). */
export const PATCH_ENABLED = new Set([
  'abaco-theme',
  'abaco-voice',
  'abaco-documents',
  'abaco-agent-status',
  'abaco-browser',
  'abaco-memory',
  'abaco-mediacion-pilot',
  'abaco-effect-broker',
])

/**
 * F1 admission — immutable manifests (P3 fix).
 *
 * Trust anchor: pinned sha256 digests of the CANONICAL form of each admitted
 * plugin's manifest.f1.yml. The broker source is the TCB: changing a pin
 * requires changing this file, which is visible in code review.
 * Recompute with: node work/scripts/sign-manifest.mjs (see rotation procedure
 * in that script's header).
 *
 * NOTE: abaco-effect-broker itself is in PATCH_ENABLED but has NO manifest —
 * it is the broker (the TCB), not an admitted plugin. Grant/authorize requests
 * under its own identity keep failing exactly as before ('plugin not in
 * A_plugin' / 'plugin-disabled').
 */
const PINNED_MANIFEST_DIGEST = {
  'abaco-mediacion-pilot': '65f19678344e06081dd52cb7e467de3b1a86dda595ba64b85f735399d9d2c533',
  'abaco-voice': 'd534ea78d9133ff560f6e6b585035ad395915092b03a47cecc21c5449fc48f00',
}

/** Fail-closed state: null = admissions verified OK; string = failure reason. */
let admissionFailure = null

function deepFreezeCaps(caps) {
  return Object.freeze({
    effects: Object.freeze([...caps.effects]),
    resources: Object.freeze([...caps.resources]),
    inject: Object.freeze([...caps.inject]),
    trust_ceiling: caps.trust_ceiling,
  })
}

/**
 * Load + verify every pinned manifest at broker init (cached — runs once).
 * On ANY failure (missing file, unparseable, id mismatch, digest mismatch)
 * the broker goes fail-closed: authorize() denies everything with
 * reason 'manifest-integrity' and issueTaskGrant() throws.
 * @returns {Record<string, {effects: string[], resources: string[], inject: string[], trust_ceiling: string}>}
 */
function verifyAdmissions() {
  const capsByPlugin = {}
  const pkgDir = dirname(fileURLToPath(import.meta.url))
  for (const pluginId of Object.keys(PINNED_MANIFEST_DIGEST)) {
    const manifestPath = join(pkgDir, '..', pluginId, 'manifest.f1.yml')
    let text
    try {
      text = readFileSync(manifestPath, 'utf8')
    } catch {
      admissionFailure = `manifest-integrity: missing manifest for ${pluginId} at ${manifestPath}`
      return {}
    }
    let caps
    try {
      caps = extractManifestCaps(text)
    } catch (e) {
      admissionFailure = `manifest-integrity: unparseable manifest for ${pluginId}: ${e.message}`
      return {}
    }
    if (caps.id !== pluginId) {
      admissionFailure = `manifest-integrity: id mismatch in ${manifestPath}: got "${caps.id}"`
      return {}
    }
    const digest = manifestDigest(canonicalManifestJson(caps))
    if (digest !== PINNED_MANIFEST_DIGEST[pluginId]) {
      admissionFailure =
        `manifest-integrity: digest mismatch for ${pluginId} ` +
        `(got ${digest.slice(0, 16)}…, pinned ${PINNED_MANIFEST_DIGEST[pluginId].slice(0, 16)}…)`
      return {}
    }
    capsByPlugin[pluginId] = deepFreezeCaps(caps)
  }
  return capsByPlugin
}

/**
 * Manifest caps (F1). DERIVED from the verified signed manifests — never
 * hand-written constants. The object and every array are deeply frozen, so a
 * runtime push (the validation T-A-4 hole) throws TypeError instead of
 * silently widening admission.
 */
export const MANIFEST_CAPS = Object.freeze(verifyAdmissions())

/** Introspection for tests/ops: { ok, failure, pinned } — never the caps. */
export function getAdmissionStatus() {
  return {
    ok: admissionFailure === null,
    failure: admissionFailure,
    pinned: { ...PINNED_MANIFEST_DIGEST },
  }
}

// Control-3: seal the session admission graph from verified caps + existing
// patch.yml / preload snapshots. Additive — authorize() is unchanged.
sealLiveAdmission({
  caps: MANIFEST_CAPS,
  pinned: PINNED_MANIFEST_DIGEST,
  ok: admissionFailure === null,
  failure: admissionFailure,
  patchEnabled: PATCH_ENABLED,
  disabled: DISABLED_PLUGINS,
})

/** @type {Map<string, any>} */
const grants = new Map()

/**
 * Private registry of issued grant_ids (P1: delegación real).
 * Module-private — never exported. authorize() verifies membership here, so
 * external code cannot forge a grant: a grant_id this module never issued
 * fails delegation validation. Survives only as long as the grant entry.
 * @type {Set<string>}
 */
const issuedGrantIds = new Set()

/** Closed set of delegation bases accepted by the authorizer (A_delegación). */
const DELEGATION_BASES = new Set(['host.route-owner', 'explicit.host'])

/**
 * Verify the delegation dimension of a grant: A_ef = A_tarea ∩ A_plugin ∩ A_delegación ∩ A_política.
 * Returns true ONLY when the delegation record is well-formed, the issuer is this
 * module, the basis is in the closed set, subject matches the grant's plugin,
 * on_behalf_of is present, AND the grant_id was really issued by this module
 * (membership in the private issuedGrantIds set). Never asserted — computed.
 * @param {any} grant
 */
function delegationValid(grant) {
  if (!grant || typeof grant !== 'object') return false
  const d = grant.delegation
  if (!d || typeof d !== 'object') return false
  if (d.issuer !== 'abaco-effect-broker') return false
  if (!DELEGATION_BASES.has(d.basis)) return false
  if (d.subject !== grant.plugin_id) return false
  if (!d.on_behalf_of) return false
  return issuedGrantIds.has(grant.grant_id)
}

/** a_deleg_ok for a deny event: computed from the stored grant when verifiable, else false. */
function denyDelegOk(grantId) {
  const stored = grantId ? grants.get(grantId) : null
  return stored ? delegationValid(stored) : false
}
/** @type {any[]} */
const auditLog = []
let denyCount = 0
let allowCount = 0
let effectsWithoutGrant = 0

export function resetBrokerForTests() {
  grants.clear()
  issuedGrantIds.clear()
  auditLog.length = 0
  denyCount = 0
  allowCount = 0
  effectsWithoutGrant = 0
  // F2: breakers y audit de la cascada viven por plugin/proceso; se reinician
  // con el broker para que los tests sean deterministas.
  resetBreakersForTests()
  resetCascadeForTests()
  cascadeForwardedSeq = 0
  // NOTA: el hash-chain de provenance.audit() NO se reinicia aquí: es el
  // registro tamper-evident de durabilidad. Los tests lo reinician con
  // resetProvenanceAuditForTests() cuando lo necesitan.
}

export function getBrokerStats() {
  return {
    denyCount,
    allowCount,
    effectsWithoutGrant,
    auditSize: auditLog.length,
    openGrants: [...grants.values()].filter((g) => !g.revoked).length,
  }
}

export function getAuditLog() {
  return auditLog.slice()
}

function sha256(s) {
  return createHash('sha256').update(String(s)).digest('hex')
}

/* ------------------------------------------------------------------ */
/* F2 — telemetría del broker hacia los breakers + reenvío de audit.   */
/* ------------------------------------------------------------------ */

/** Severidad con la que cada razón de deny alimenta el breaker del plugin.
 *  Una sola fuente ('broker-authorize') jamás dispara el kill: exige 2
 *  fuentes independientes (regla dura de breakers.js). */
const DENY_SIGNAL_SEVERITY = {
  'no-identity': 1,
  'plugin-disabled': 2,
  'unknown-plugin': 2,
  'manifest-integrity': 3,
  'effect-not-in-grant': 2,
  'data-as-control': 3,
  'skill-cannot-register-tool': 3,
  'compose-mutate-forbidden': 3,
  'delegation-invalid': 3,
  'grant-revoked': 2,
  'ttl-expired': 2,
  'budget-exceeded': 2,
  'trust-ceiling': 2,
  'resource-not-in-grant': 2,
  policy: 2,
  'provenance-drift': 3,
  'cascade-escalation': 3,
  'breaker-quarantine': 2,
  'breaker-kill': 3,
  'breaker-blocklisted': 3,
}

/** Último seq del audit de cascada ya reenviado a provenance (idempotencia). */
let cascadeForwardedSeq = 0

/**
 * Decisión (d): reenvía el audit interno de la cascada (p. ej.
 * 'advisor-downgrade-attempt') al hash-chain append-only de
 * provenance.audit(). Idempotente por seq: cada evento se reenvía una vez.
 * @returns {number} eventos reenviados en esta llamada
 */
export function forwardCascadeAudit() {
  const fresh = getCascadeAudit().filter((e) => e.seq > cascadeForwardedSeq)
  for (const e of fresh) {
    provenanceAudit({
      kind: 'cascade',
      cascade_seq: e.seq,
      ts: e.ts,
      event: e.kind,
      layer: e.layer || null,
      plugin_id: e.pluginId || null,
      finding_kind: e.findingKind || null,
      floor: e.floor ?? null,
      attempted: e.attempted ?? null,
    })
    cascadeForwardedSeq = e.seq
  }
  return fresh.length
}

/** Verifica el hash-chain donde vive el audit reenviado de la cascada. */
export function verifyF2Audit() {
  return verifyProvenanceAudit()
}

export function hashArgs(args) {
  return sha256(JSON.stringify(args ?? null))
}

/**
 * Channel identity — never trust body.plugin_id.
 * @param {{ kind: string, pluginId?: string, path?: string, toolId?: string, preloadKey?: string }} channel
 */
export function resolveIdentity(channel) {
  if (!channel || typeof channel !== 'object') return null
  if (channel.kind === 'host.fetch') {
    // Owner of the route is abaco-voice for voice paths (lock: identity = route owner).
    if (channel.path && String(channel.path).startsWith('/api/abaco-voice.')) return 'abaco-voice'
    if (channel.pluginId && PATCH_ENABLED.has(channel.pluginId) && !DISABLED_PLUGINS.has(channel.pluginId)) {
      return channel.pluginId
    }
    return null
  }
  if (channel.kind === 'cordis.host') {
    return channel.pluginId || null
  }
  if (channel.kind === 'preload') {
    return null // preload is TCB, not a plugin identity for grants
  }
  if (channel.kind === 'tool') {
    return channel.pluginId || null
  }
  return null
}

function aPluginOk(pluginId) {
  if (!pluginId) return false
  if (DISABLED_PLUGINS.has(pluginId)) return false
  if (!PATCH_ENABLED.has(pluginId)) return false
  if (!MANIFEST_CAPS[pluginId]) return false
  return true
}

/**
 * P2 (F1-FIX): provenance binding for trust_in.
 *
 * The `trust_in` field in the request body is now only a CLAIM made by the
 * caller (the fiber asserted its own provenance — gap P2). The channel is the
 * trustworthy source (the harness host owns it), so the broker derives the
 * maximum trust the channel can vouch for and uses
 *   effective = min(rank(claim), rank(deriveChannelTrust(channel)))
 * in every FIDES-lite sink rule, the auto-grant path, and the trust-ceiling
 * check. A fiber can no longer upgrade its data's trust by asserting it.
 *
 * Channel → provenance map (pilot scope):
 * - host.fetch + path under /api/abaco-voice.* → 'user'.
 *   Route-owner lock (same prefix test as resolveIdentity): the host itself
 *   registered this route, so a request arriving here is treated as a
 *   user-initiated action on the host's own UI surface.
 * - host.fetch + PATCH_ENABLED pluginId, no route-owner lock → 'plugin-data'.
 *   Identity is verified, but nothing vouches for user initiation.
 * - tool → 'plugin-data'. The tool identity is known, but the payload is
 *   plugin-supplied data; the channel cannot vouch user initiation.
 * - cordis.host → 'user' (conservative pilot choice).
 *   The harness host is TCB, but the data crossing it here is plugin data.
 *   'host' trust is NOT auto-vouched in pilot; that requires an explicit
 *   host-attested path (grant trust_ceiling caps at 'user' anyway).
 * - preload / absent / unknown channel → 'untrusted'.
 *
 * @param {{ kind: string, pluginId?: string, path?: string }} channel
 * @returns {TrustLabel}
 */
export function deriveChannelTrust(channel) {
  if (!channel || typeof channel !== 'object') return 'untrusted'
  if (channel.kind === 'host.fetch') {
    if (channel.path && String(channel.path).startsWith('/api/abaco-voice.')) return 'user'
    if (channel.pluginId && PATCH_ENABLED.has(channel.pluginId) && !DISABLED_PLUGINS.has(channel.pluginId)) {
      return 'plugin-data'
    }
    return 'untrusted'
  }
  if (channel.kind === 'tool') return 'plugin-data'
  if (channel.kind === 'cordis.host') return 'user'
  return 'untrusted'
}

/**
 * Issue a short-lived task grant (host/HITL only — not from untrusted data).
 */
export function issueTaskGrant({
  pluginId,
  effects,
  resources,
  ttlMs = 60_000,
  budget = { calls: 4, bytes: 25 * 1024 * 1024 },
  trustCeiling = 'user',
  taskId = null,
}) {
  if (admissionFailure) {
    throw new Error(`issueTaskGrant: ${admissionFailure}`)
  }
  if (!aPluginOk(pluginId)) {
    throw new Error('issueTaskGrant: plugin not in A_plugin')
  }
  const caps = MANIFEST_CAPS[pluginId]
  const eff = (effects || []).filter((e) => caps.effects.includes(e))
  const res = (resources || []).filter((r) => caps.resources.includes(r))
  const grant = {
    grant_id: randomUUID(),
    plugin_id: pluginId,
    task_id: taskId || randomUUID(),
    effects: eff,
    resources: res,
    ttl_ms: ttlMs,
    budget: { calls: budget.calls, bytes: budget.bytes },
    trust_ceiling: trustCeiling,
    issued_at: Date.now(),
    revoked: false,
    calls_used: 0,
    bytes_used: 0,
    // Delegation record (P1: A_delegación real, not asserted).
    // Explicit host issuance: the broker module is the TCB emitter in the pilot.
    delegation: {
      issuer: 'abaco-effect-broker',
      basis: 'explicit.host',
      subject: pluginId,
      on_behalf_of: 'host',
    },
  }
  grants.set(grant.grant_id, grant)
  issuedGrantIds.add(grant.grant_id)
  return grant
}

export function revokeGrant(grantId) {
  const g = grants.get(grantId)
  if (g) g.revoked = true
  return !!g
}

/**
 * Read-only grant inspection for the control-2 cell (Pack B).
 * Does not authorize, issue, revoke, or spend budget. Atena never lives here.
 * @param {string} grantId
 * @returns {{ live: boolean, reason: string, grant: object | null }}
 */
export function inspectGrant(grantId) {
  if (!grantId || typeof grantId !== 'string') {
    return { live: false, reason: 'missing-grant', grant: null }
  }
  const g = grants.get(grantId)
  if (!g) return { live: false, reason: 'unknown-grant', grant: null }
  const snap = Object.freeze({
    grant_id: g.grant_id,
    plugin_id: g.plugin_id,
    task_id: g.task_id,
    effects: Object.freeze([...(g.effects || [])]),
    resources: Object.freeze([...(g.resources || [])]),
    revoked: !!g.revoked,
    issued_at: g.issued_at,
    ttl_ms: g.ttl_ms,
    trust_ceiling: g.trust_ceiling,
  })
  if (g.revoked) return { live: false, reason: 'grant-revoked', grant: snap }
  if (Date.now() - g.issued_at > g.ttl_ms) {
    return { live: false, reason: 'ttl-expired', grant: snap }
  }
  if (!delegationValid(g)) {
    return { live: false, reason: 'delegation-invalid', grant: snap }
  }
  return { live: true, reason: 'ok', grant: snap }
}

function findActiveGrant(pluginId, taskId) {
  for (const g of grants.values()) {
    if (g.revoked) continue
    if (g.plugin_id !== pluginId) continue
    if (taskId && g.task_id !== taskId) continue
    if (Date.now() - g.issued_at > g.ttl_ms) continue
    return g
  }
  return null
}

function pushAudit(ev) {
  auditLog.push(ev)
  // Best-effort durable audit under harness home (never dsh-desktop).
  const home = process.env.DSH_HOME || process.env.HOME
  if (!home) return
  const dir = join(home, 'abaco-deep-core-audit-f1')
  const line = JSON.stringify(ev) + '\n'
  mkdir(dir, { recursive: true }).then(() =>
    appendFile(join(dir, 'effects.jsonl'), line).catch(() => {})
  ).catch(() => {})
}

/**
 * Unique authorizer. Atena (asesor) never lives here — cero Atena en authorize.
 * @returns {{ decision: 'allow', grant: any } | { decision: 'deny', reason: string }}
 */
export function authorize(req) {
  const started = Date.now()
  const monotonic = Number(process.hrtime.bigint() / 1000000n)
  try {
    // Fail-closed: without valid signed manifests there is no admission at all.
    if (admissionFailure) {
      const pluginId = req && typeof req === 'object' ? resolveIdentity(req.channel) : null
      return deny(
        'manifest-integrity',
        pluginId,
        req?.task_id || null,
        req?.effect || null,
        null,
        started,
        monotonic,
        { a_plugin_ok: false },
      )
    }
    if (!req || typeof req !== 'object') {
      return deny('no-identity', null, null, null, null, started, monotonic)
    }
    // Ignore forged body plugin_id — only channel.
    const pluginId = resolveIdentity(req.channel)
    if (!pluginId) {
      return deny('no-identity', null, req.task_id || null, req.effect || null, null, started, monotonic)
    }

    // F2: contexto aditivo de las 4 consultas. Nunca cambia razones F1
    // existentes; solo añade el campo `f2` al audit y razones nuevas en
    // escenarios nuevos (unknown-plugin, breaker-*, provenance-drift,
    // cascade-escalation).
    const f2 = {
      tier: null,
      disabled: false,
      f2_effective: null,
      breaker_level: 0,
      breaker_threat: 0,
      breaker_throttled: false,
      human_approval: 'absent',
      cascade: null,
    }

    // F2 (1): tiers — plugin desconocido o deshabilitado → deny.
    // Deny-by-default: tierOf -1 = lo más restrictivo.
    f2.tier = tierOf(pluginId)
    if (f2.tier === -1) {
      return deny(
        'unknown-plugin',
        pluginId,
        req.task_id || null,
        req.effect || null,
        null,
        started,
        monotonic,
        {},
        null,
        f2,
      )
    }
    if (isDisabled(pluginId)) {
      f2.disabled = true
      return deny(
        'plugin-disabled',
        pluginId,
        req.task_id || null,
        req.effect || null,
        null,
        started,
        monotonic,
        {},
        null,
        f2,
      )
    }
    if (DISABLED_PLUGINS.has(pluginId)) {
      f2.disabled = true
      return deny('plugin-disabled', pluginId, req.task_id || null, req.effect || null, null, started, monotonic, {}, null, f2)
    }

    // F2 (c): humanApproval = flag EXPLÍCITO en la señal. Solo se honra si
    // el canal atestigua trust 'host' (F2: 'system'); en pilot ningún canal
    // lo atestigua → se ignora y se audita. La fuente humana autorizada es
    // decisión pendiente del líder (ver veredicto F2).
    if (req.human_approval === true) {
      if (deriveChannelTrust(req.channel) === 'host') {
        f2.human_approval = 'honored'
        breakerRecord(pluginId, {
          type: req.human_action === 'release' ? 'human-release' : 'human-kill',
          severity: req.human_action === 'release' ? 0 : 3,
          source: 'human',
          humanApproval: true,
        })
      } else {
        f2.human_approval = 'ignored'
      }
    }

    // F2 (3): breakers — quarantine/kill/blocklist → deny (throttle solo
    // marca, no deniega por sí solo). Consulta ANTES de la lógica F1 restante.
    const breakerPre = breakerState(pluginId)
    f2.breaker_level = breakerPre.level
    f2.breaker_threat = breakerPre.threat
    if (breakerPre.level >= BREAKER_LEVELS.QUARANTINE) {
      const reason =
        breakerPre.level === BREAKER_LEVELS.BLOCKLISTED
          ? 'breaker-blocklisted'
          : breakerPre.level === BREAKER_LEVELS.KILL
            ? 'breaker-kill'
            : 'breaker-quarantine'
      return deny(
        reason,
        pluginId,
        req.task_id || null,
        req.effect || null,
        null,
        started,
        monotonic,
        {},
        null,
        f2,
      )
    }
    f2.breaker_throttled = breakerPre.level === BREAKER_LEVELS.THROTTLE
    if (!PATCH_ENABLED.has(pluginId) || !MANIFEST_CAPS[pluginId]) {
      return deny('plugin-disabled', pluginId, req.task_id || null, req.effect || null, null, started, monotonic)
    }

    const effect = req.effect
    if (!effect || !effect.kind || !effect.resource) {
      return deny('effect-not-in-grant', pluginId, req.task_id || null, effect || null, null, started, monotonic)
    }

    // P2: trust_in is a CLAIM, not a fact. Provenance is bound to the channel:
    // the broker, not the caller, decides how much trust the channel vouches.
    // Effective trust = min(claim, channel) — the fiber cannot upgrade its data.
    const trustInClaim = typeof req.trust_in === 'string' && req.trust_in ? req.trust_in : 'untrusted'
    // Malformed/unknown claim labels fail closed (rank 0 = untrusted).
    const claimRank = TRUST_RANK[trustInClaim] !== undefined ? TRUST_RANK[trustInClaim] : 0
    const channelTrust = deriveChannelTrust(req.channel)
    const trustInEffRank = Math.min(claimRank, TRUST_RANK[channelTrust])
    const trustIn = TRUST_LABELS[trustInEffRank] // effective: what every FIDES rule uses
    const trustCtx = {
      claim: trustInClaim,
      effective: trustIn,
      downgraded: trustInEffRank < claimRank,
    }

    // F2 (2): procedencia efectiva bajo el ordinal F2 (6 niveles) como
    // verificación cruzada fail-closed de la regla P2. Decisión (a):
    // host(F1) ↔ system(F2); deriveChannelTrust nunca emite
    // guardian/developer en pilot, así que ambas escalas coinciden siempre.
    // Si alguna vez divergen → deny (la escala F1 de los sinks no se tocó).
    const f2prov = provenanceTag({
      content: effect.kind + '|' + String(effect.resource),
      claim: F1_TO_F2_TRUST[trustInClaim] || 'untrusted',
      channel: F1_TO_F2_TRUST[channelTrust] || 'untrusted',
    })
    f2.f2_effective = f2prov.effective
    if ((F2_TO_F1_TRUST[f2prov.effective] || 'untrusted') !== trustIn) {
      return deny(
        'provenance-drift',
        pluginId,
        req.task_id || null,
        effect,
        null,
        started,
        monotonic,
        {},
        trustCtx,
        f2,
      )
    }

    // Sinks that data must never drive as control (FIDES-lite).
    // 'plugin-data' can no longer originate control either: before P2 a fiber
    // on the tool channel could claim trust_in:'user' and this gate ran on
    // the claim; now it runs on the channel-derived effective trust, so
    // tool-channel data is 'plugin-data' at best and cannot spawn/write/fetch.
    if (effect.kind === 'tool.register' && trustIn !== 'user' && trustIn !== 'host') {
      return deny(
        'skill-cannot-register-tool',
        pluginId,
        req.task_id || null,
        effect,
        null,
        started,
        monotonic,
        {},
        trustCtx,
      )
    }
    if (
      (effect.kind === 'compose.mutate' || effect.kind === 'grant.mutate') &&
      (trustIn === 'untrusted' || trustIn === 'plugin-data')
    ) {
      return deny(
        effect.kind === 'compose.mutate' ? 'compose-mutate-forbidden' : 'data-as-control',
        pluginId,
        req.task_id || null,
        effect,
        null,
        started,
        monotonic,
        {},
        trustCtx,
      )
    }
    if (
      (effect.kind === 'proc.spawn' || effect.kind === 'fs.write' || effect.kind === 'net.fetch') &&
      (trustIn === 'untrusted' || trustIn === 'plugin-data')
    ) {
      return deny('data-as-control', pluginId, req.task_id || null, effect, null, started, monotonic, {}, trustCtx)
    }

    const caps = MANIFEST_CAPS[pluginId]
    const aPlugin =
      caps.effects.includes(effect.kind) &&
      (caps.resources.includes(effect.resource) ||
        caps.resources.some((r) => effect.resource.startsWith(r.replace(/\*$/, ''))))

    if (!aPlugin) {
      return deny('effect-not-in-grant', pluginId, req.task_id || null, effect, null, started, monotonic, {
        a_plugin_ok: false,
      }, trustCtx)
    }

    // Auto-issue ephemeral task grant for host.fetch voice routes when task missing
    // (user mic click = trust user). Still requires authorize before spawn.
    let grant = null
    let grantIdClaimed = null
    if (req.grant_id) {
      grantIdClaimed = req.grant_id
      grant = grants.get(req.grant_id) || null
    } else if (req.task_id) {
      grant = findActiveGrant(pluginId, req.task_id)
    }

    if (!grant && req.channel?.kind === 'host.fetch' && trustIn === 'user') {
      grant = issueTaskGrant({
        pluginId,
        effects: caps.effects,
        resources: caps.resources,
        ttlMs: 60_000,
        trustCeiling: caps.trust_ceiling,
        taskId: req.task_id || undefined,
      })
      // Delegation is real here, not asserted: pluginId came from
      // resolveIdentity(req.channel) (channel-derived; body plugin_id ignored).
      // Record the basis explicitly instead of leaving it implicit.
      grant.delegation = {
        issuer: 'abaco-effect-broker',
        basis: 'host.route-owner',
        subject: pluginId,
        on_behalf_of: pluginId, // route owner = channel-derived identity
        channel_kind: req.channel.kind,
      }
    }

    if (!grant) {
      if (grantIdClaimed) {
        // A grant_id was claimed but this module never issued it → delegation fails.
        return deny('delegation-invalid', pluginId, req.task_id || null, effect, null, started, monotonic, {}, trustCtx)
      }
      return deny('effect-not-in-grant', pluginId, req.task_id || null, effect, null, started, monotonic, {
        a_tarea_ok: false,
      }, trustCtx)
    }
    if (!delegationValid(grant)) {
      // Grant resolves in the map but its delegation record is missing or tampered.
      return deny('delegation-invalid', pluginId, grant.task_id, effect, grant.grant_id, started, monotonic, {}, trustCtx)
    }
    if (grant.revoked) {
      return deny('grant-revoked', pluginId, grant.task_id, effect, grant.grant_id, started, monotonic, {}, trustCtx)
    }
    if (Date.now() - grant.issued_at > grant.ttl_ms) {
      return deny('ttl-expired', pluginId, grant.task_id, effect, grant.grant_id, started, monotonic, {}, trustCtx)
    }
    if (!grant.effects.includes(effect.kind)) {
      return deny('effect-not-in-grant', pluginId, grant.task_id, effect, grant.grant_id, started, monotonic, {}, trustCtx)
    }
    if (
      !grant.resources.includes(effect.resource) &&
      !grant.resources.some((r) => String(effect.resource).startsWith(String(r)))
    ) {
      return deny('resource-not-in-grant', pluginId, grant.task_id, effect, grant.grant_id, started, monotonic, {}, trustCtx)
    }
    if (TRUST_RANK[trustIn] > TRUST_RANK[grant.trust_ceiling]) {
      // trust_in higher than ceiling means data claims more authority than grant allows
      return deny('trust-ceiling', pluginId, grant.task_id, effect, grant.grant_id, started, monotonic, {}, trustCtx)
    }
    // Actually FIDES: trust_in is label of *data*; if data is untrusted and ceiling is user, spawn already denied above.
    // If trust_in is host and ceiling is user, deny trust-ceiling (data more trusted than grant — odd); keep simple:
    if (TRUST_RANK[trustIn] > TRUST_RANK[grant.trust_ceiling]) {
      return deny('trust-ceiling', pluginId, grant.task_id, effect, grant.grant_id, started, monotonic, {}, trustCtx)
    }
    if (grant.calls_used >= grant.budget.calls) {
      return deny('budget-exceeded', pluginId, grant.task_id, effect, grant.grant_id, started, monotonic, {}, trustCtx)
    }

    // F2 (4): cascada asesora — SOLO puede SUBIR la severidad, nunca bajarla.
    // Corre únicamente en el camino que F1 aprobaría: severity 3 (critical)
    // → deny 'cascade-escalation' (escalada permitida: allow→deny); severity
    // 2 → se marca en el audit pero el allow se mantiene (G0 decide);
    // 0/1 → sin cambios. Un deny de F1 jamás se convierte en allow: la
    // cascada no corre en ningún camino de deny (regla de oro).
    const cascadeSignals = []
    if (trustCtx.downgraded) {
      cascadeSignals.push({ type: 'provenance-downgrade', severity: 1, source: 'broker-provenance' })
    }
    if (f2.breaker_threat >= 1) {
      cascadeSignals.push({ type: 'breaker-threat', severity: f2.breaker_threat, source: 'broker-breakers' })
    }
    const advisor = cascadeEvaluate({
      kind: effect.kind,
      pluginId,
      provenance: {
        claim: F1_TO_F2_TRUST[trustInClaim] || 'untrusted',
        channel: F1_TO_F2_TRUST[channelTrust] || 'untrusted',
        effective: f2prov.effective,
      },
      signals: cascadeSignals,
      context: {},
    })
    f2.cascade = {
      severity: advisor.severity,
      decidedBy: advisor.decidedBy,
      notes: advisor.advisorNotes,
    }
    // Decisión (d): el audit de la cascada → hash-chain de provenance.
    forwardCascadeAudit()
    if (advisor.severity >= 3) {
      return deny(
        'cascade-escalation',
        pluginId,
        grant.task_id,
        effect,
        grant.grant_id,
        started,
        monotonic,
        {},
        trustCtx,
        f2,
      )
    }

    // F2: el allow también alimenta el breaker (señal limpia, severity 0):
    // es la fuente de "ventana limpia" que permite la desescalada por
    // histéresis (throttle→observe). Sin señales limpias, la amenaza solo
    // podría bajar por detectores externos o release humano.
    try {
      breakerRecord(pluginId, { type: 'allow', severity: 0, source: 'broker-authorize' })
    } catch {
      /* noop: telemetría jamás rompe el autorizador */
    }

    grant.calls_used += 1
    allowCount += 1
    const budgetAfter = {
      calls: grant.budget.calls - grant.calls_used,
      bytes: grant.budget.bytes - grant.bytes_used,
    }
    pushAudit({
      ts: Date.now(),
      monotonic_ms: monotonic,
      decision: 'allow',
      reason: 'ok',
      plugin_id: pluginId,
      task_id: grant.task_id,
      effect,
      grant_id: grant.grant_id,
      a_plugin_ok: true,
      a_tarea_ok: true,
      a_deleg_ok: delegationValid(grant), // computed, never asserted (validated above)
      a_pol_ok: true,
      delegation: grant.delegation,
      trust_in_claim: trustInClaim, // P2: what the caller asserted (claim)
      trust_in_effective: trustIn, // P2: what the broker used (min(claim, channel))
      trust_downgraded: trustCtx.downgraded, // P2: true when the channel capped the claim
      side_effect: false,
      budget_after: budgetAfter,
      breaker: 'unchanged',
      f2, // F2: contexto aditivo de las 4 consultas (tiers/provenance/breakers/cascada)
      trace_id: randomUUID(),
    })
    return { decision: 'allow', grant: { ...grant } }
  } catch {
    return deny('policy', null, req?.task_id || null, req?.effect || null, null, Date.now(), monotonic)
  }
}

function deny(reason, pluginId, taskId, effect, grantId, started, monotonic, flags = {}, trust = null, f2ctx = null) {
  denyCount += 1
  // F2: el broker alimenta los breakers con sus denies (telemetría, fuente
  // 'broker-authorize'). Los denies 'breaker-*' NO se re-alimentan: el
  // breaker ya lo sabe y así se evita la auto-escalada kill→blocklist por
  // la propia telemetría. La telemetría jamás rompe el autorizador.
  if (pluginId && !String(reason).startsWith('breaker-')) {
    try {
      breakerRecord(pluginId, {
        type: 'deny:' + reason,
        severity:
          DENY_SIGNAL_SEVERITY[reason] !== undefined ? DENY_SIGNAL_SEVERITY[reason] : 2,
        source: 'broker-authorize',
      })
    } catch {
      /* noop: fail-closed ya está garantizado por el deny */
    }
  }
  const ev = {
    ts: Date.now(),
    monotonic_ms: monotonic,
    decision: 'deny',
    reason,
    plugin_id: pluginId,
    task_id: taskId,
    effect: effect || { kind: 'unknown', resource: '', args_hash: '' },
    grant_id: grantId,
    a_plugin_ok: flags.a_plugin_ok !== undefined ? flags.a_plugin_ok : reason !== 'plugin-disabled',
    a_tarea_ok: flags.a_tarea_ok !== undefined ? flags.a_tarea_ok : true,
    a_deleg_ok: denyDelegOk(grantId), // computed from the stored grant; false when not evaluated
    a_pol_ok: reason !== 'policy',
    trust_in_claim: trust ? trust.claim : null, // P2: what the caller asserted
    trust_in_effective: trust ? trust.effective : null, // P2: what the broker used
    trust_downgraded: trust ? trust.downgraded : null, // P2: null when provenance was not evaluated
    side_effect: false,
    budget_after: null,
    breaker: 'unchanged',
    f2: f2ctx ? { ...f2ctx } : null, // F2: contexto aditivo de las 4 consultas
    trace_id: randomUUID(),
  }
  pushAudit(ev)
  return { decision: 'deny', reason, audit: ev }
}

/** Test helper: assert no unmediated side effects recorded. */
export function assertZeroEffectsWithoutGrant() {
  if (effectsWithoutGrant !== 0) {
    throw new Error(`effectsWithoutGrant=${effectsWithoutGrant}`)
  }
}

export function markLegacyUnmediated() {
  effectsWithoutGrant += 1
}
