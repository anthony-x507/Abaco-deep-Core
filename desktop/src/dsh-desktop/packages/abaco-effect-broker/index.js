/**
 * F1 Effect Broker (Harness host).
 * authorize() is the ONLY path to protected sinks in the pilot scope.
 * Identity comes from ChannelIdentity — body plugin_id is ignored.
 * Cero Atena (asesor) en authorize. Janice = runtime (plugins) elsewhere.
 * @module abaco-effect-broker
 */

import { createHash, randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
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
  DURABLE_GENESIS,
  sealDurableLine,
  verifyDurableLine,
  verifyDurableChain,
  verifyDurableEffectsFile,
} from './provenance.js'

export {
  DURABLE_GENESIS,
  sealDurableLine,
  verifyDurableLine,
  verifyDurableChain,
  verifyDurableEffectsFile,
}
import {
  evaluate as cascadeEvaluate,
  getCascadeAudit,
  resetCascadeForTests,
} from './cascade.js'
import { sealLiveAdmission, getAdmissionGraph, SEALED_PRELOAD_KEYS } from './admission.js'
import { evaluatePluginTree } from './supply-chain-admission.mjs'
import {
  isMcpPublicName,
  verifyMcpToolSchema,
} from '../abaco-mcp-schema-pin/index.js'

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
  parsePatchInsertIds,
} from './admission.js'

/** @typedef {'host'|'user'|'plugin-data'|'untrusted'} TrustLabel */
/** @typedef {'ui.slot'|'host.fetch'|'tool.call'|'tool.register'|'ipc.invoke'|'fs.read'|'fs.write'|'net.fetch'|'proc.spawn'|'grant.mutate'|'compose.mutate'} EffectKind */

const TRUST_RANK = { untrusted: 0, 'plugin-data': 1, user: 2, host: 3 }
/** Rank → label, same order as TRUST_RANK (P2 provenance: do not reorder). */
const TRUST_LABELS = ['untrusted', 'plugin-data', 'user', 'host']

/* INV-ISOLATION-CLASS (piloto): face/UI in-process; high-risk provider subprocess (python); F1-pilot → UtilityProcess (mediacion-pilot). */
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

/**
 * Artifact subject pins (sha256 of ARTIFACT_FILES bytes). A package.json
 * version match does not satisfy this pin. Recompute with
 * `node scripts/sign-manifest.mjs` from the repo root. Rotation is a review
 * of this constant, not a runtime API.
 *
 * Missing `sbom.admission.json` fails closed (HOLD, broker admissionFailure).
 */
const PINNED_ARTIFACT = {
  'abaco-mediacion-pilot': {
    version: '0.1.0',
    digest: 'e5271dd4ad0214d778c75cbb12e2c6b2a552676daf211780c9650c583498863e',
  },
  'abaco-voice': {
    version: '0.1.0',
    digest: '4360dc2b6f6adaf3c69c28f15078416dbaf637d4529dddf000373f0d921d0e2a',
  },
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
    const pin = PINNED_ARTIFACT[pluginId]
    if (!pin) {
      admissionFailure = `supply-chain: artifact pin missing for ${pluginId}`
      return {}
    }
    let supply
    try {
      supply = evaluatePluginTree(join(pkgDir, '..', pluginId), {
        pluginId,
        version: pin.version,
        digest: pin.digest,
        knownArtifactPins: Object.fromEntries(
          Object.entries(PINNED_ARTIFACT).map(([id, row]) => [id, row.digest]),
        ),
      })
    } catch (e) {
      admissionFailure = `supply-chain: unreadable artifact for ${pluginId}: ${e.message}`
      return {}
    }
    if (!supply || supply.decision !== 'admit') {
      const why = supply ? `${supply.decision}:${supply.reason}` : 'no-decision'
      admissionFailure = `supply-chain: ${why} for ${pluginId}`
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
/** Session-only unload overlay. Does not write patch.yml or a profile. */
const sessionUnloaded = new Set()
/** Session-only evolved caps (ContractEvolution + HITL). Never mutates pins. */
const sessionCaps = new Map()
/** @type {Map<string, object>} */
const contractProposals = new Map()

/** @type {any[]} */
const auditLog = []
let denyCount = 0
let allowCount = 0
let effectsWithoutGrant = 0
/** INV-TTL-BOUNDED: how many mints were clamped to MAX_TASK_TTL_MS. */
let ttlClampCount = 0

/* ------------------------------------------------------------------ */
/* INV-GRANT-MAP-CAP (Ola 1 / Bloque 3 item 3.3 — deep half)            */
/* openGrants ≤ MAX_OPEN_GRANTS; per-plugin mint rate ≤ R/s. Excess →  */
/* throw at mint + audit. Advisors never mint.                         */
/* ------------------------------------------------------------------ */
export let MAX_OPEN_GRANTS = 64
export let MAX_MINT_RATE_PER_SEC = 8
/** @type {Map<string, number[]>} pluginId → mint timestamps (ms), pruned window */
const mintTimestampsByPlugin = new Map()
let grantMapCapDenyCount = 0
let mintRateDenyCount = 0

/** Test-only: override grant-map caps. Pass nulls to restore defaults. */
export function setGrantMapLimitsForTests(openMax, ratePerSec) {
  MAX_OPEN_GRANTS = openMax == null ? 64 : openMax
  MAX_MINT_RATE_PER_SEC = ratePerSec == null ? 8 : ratePerSec
}

/* ------------------------------------------------------------------ */
/* INV-DURABLE-AUDIT-FAIL-CLOSED (Ola 1 / Bloque 1 item 1.3)            */
/* After K consecutive durable effects.jsonl append failures, authorize */
/* denies NEW effects with reason `audit-unavailable`. Tip-of-spear:    */
/* already-admitted ui.slot may continue — do not freeze the UI fleet,  */
/* do not mass-unload/revoke. In-memory auditLog + provenance stay live.*/
/* Operator counters/alerts via getBrokerStats(). Advisors never gated. */
/* ------------------------------------------------------------------ */

/** Consecutive durable-append failures before authorize fail-closes. */
export const DURABLE_AUDIT_FAIL_THRESHOLD = 5

let durableAppendConsecutiveFailures = 0
let durableAppendFailureTotal = 0
let durableAuditUnavailable = false
let durableAuditAlertCount = 0
let durableAuditLastError = null

/* Ola 2 / Bloque 2.A — on-disk effects.jsonl independent hash-chain (INV-AUDIT-CHAIN). */
let durableFileSeq = 0
let durableFileTipHash = DURABLE_GENESIS
let durableFileTipLoaded = false
let durableFileLoadedPath = null

/**
 * Resolve harness durable effects.jsonl path (never dsh-desktop Application Support).
 * @returns {string | null}
 */
export function getDurableEffectsPath() {
  const home = process.env.DSH_HOME || process.env.HOME
  if (!home) return null
  return join(home, 'abaco-deep-core-audit-f1', 'effects.jsonl')
}

/**
 * Load tip from existing effects.jsonl. Corrupt / unlinked chain → throw
 * (fail-closed; scheduleDurableAppend counts as durable failure → breaker).
 * @param {string} filePath
 */
function loadDurableTipFromFile(filePath) {
  if (durableFileTipLoaded && durableFileLoadedPath === filePath) return
  if (!existsSync(filePath)) {
    durableFileSeq = 0
    durableFileTipHash = DURABLE_GENESIS
    durableFileTipLoaded = true
    durableFileLoadedPath = filePath
    return
  }
  const text = readFileSync(filePath, 'utf8')
  if (!verifyDurableEffectsFile(text)) {
    throw new Error('durable-effects-chain-invalid')
  }
  const lines = text.split('\n').filter((l) => l.length > 0)
  const last = lines.length ? JSON.parse(lines[lines.length - 1]) : null
  durableFileSeq = lines.length
  durableFileTipHash = last && typeof last.hash === 'string' ? last.hash : DURABLE_GENESIS
  durableFileTipLoaded = true
  durableFileLoadedPath = filePath
}

/**
 * Default durable sink: sealed JSONL under harness home (prev_hash + hash).
 * Missing home = durable not configured (not a failure).
 * Sync write so tip/seq stay consistent with the on-disk chain.
 * @param {object} ev
 * @returns {void}
 */
function defaultDurableAppend(ev) {
  const filePath = getDurableEffectsPath()
  if (!filePath) return
  mkdirSync(dirname(filePath), { recursive: true })
  loadDurableTipFromFile(filePath)
  const sealed = sealDurableLine({
    seq: durableFileSeq,
    entry: ev,
    prev_hash: durableFileTipHash,
  })
  appendFileSync(filePath, JSON.stringify(sealed) + '\n')
  durableFileSeq += 1
  durableFileTipHash = sealed.hash
}

/**
 * Verify on-disk effects.jsonl at the harness path (or explicit path).
 * Missing file = empty chain = valid. Fail-closed on tamper.
 * @param {string} [explicitPath]
 * @returns {boolean}
 */
export function verifyDurableEffectsOnDisk(explicitPath) {
  const filePath = explicitPath || getDurableEffectsPath()
  if (!filePath) return true
  if (!existsSync(filePath)) return true
  try {
    return verifyDurableEffectsFile(readFileSync(filePath, 'utf8'))
  } catch {
    return false
  }
}

/** @type {(ev: object) => (Promise<void> | void)} */
let durableAppendImpl = defaultDurableAppend

function noteDurableAppendSuccess() {
  durableAppendConsecutiveFailures = 0
  durableAuditUnavailable = false
  durableAuditLastError = null
}

function noteDurableAppendFailure(err) {
  durableAppendConsecutiveFailures += 1
  durableAppendFailureTotal += 1
  durableAuditLastError =
    err && typeof err === 'object' && err.message
      ? String(err.message)
      : String(err || 'durable-append-failed')
  if (durableAppendConsecutiveFailures >= DURABLE_AUDIT_FAIL_THRESHOLD) {
    if (!durableAuditUnavailable) durableAuditAlertCount += 1
    durableAuditUnavailable = true
  }
}

function scheduleDurableAppend(ev) {
  let result
  try {
    result = durableAppendImpl(ev)
  } catch (err) {
    noteDurableAppendFailure(err)
    return
  }
  if (result != null && typeof result.then === 'function') {
    result.then(
      () => noteDurableAppendSuccess(),
      (err) => noteDurableAppendFailure(err),
    )
    return
  }
  noteDurableAppendSuccess()
}

/** True when authorize must fail-close new (non tip-of-spear UI) effects. */
export function isDurableAuditUnavailable() {
  return durableAuditUnavailable === true
}

/**
 * Operator / test snapshot of the durable-audit breaker.
 * @returns {{
 *   consecutiveFailures: number,
 *   failureTotal: number,
 *   unavailable: boolean,
 *   threshold: number,
 *   alertCount: number,
 *   lastError: string | null,
 * }}
 */
export function getDurableAuditStatus() {
  return {
    consecutiveFailures: durableAppendConsecutiveFailures,
    failureTotal: durableAppendFailureTotal,
    unavailable: durableAuditUnavailable,
    threshold: DURABLE_AUDIT_FAIL_THRESHOLD,
    alertCount: durableAuditAlertCount,
    lastError: durableAuditLastError,
  }
}

/**
 * Test-only: replace durable append implementation (stub FS errors).
 * Pass null/undefined to restore the default JSONL sink.
 * @param {null | undefined | ((ev: object) => (Promise<void> | void))} fn
 */
export function setDurableAppendForTests(fn) {
  durableAppendImpl = typeof fn === 'function' ? fn : defaultDurableAppend
}

function resetDurableAuditForTests() {
  durableAppendConsecutiveFailures = 0
  durableAppendFailureTotal = 0
  durableAuditUnavailable = false
  durableAuditAlertCount = 0
  durableAuditLastError = null
  durableAppendImpl = defaultDurableAppend
  durableFileSeq = 0
  durableFileTipHash = DURABLE_GENESIS
  durableFileTipLoaded = false
  durableFileLoadedPath = null
}

export function resetBrokerForTests() {
  grants.clear()
  issuedGrantIds.clear()
  sessionUnloaded.clear()
  sessionCaps.clear()
  contractProposals.clear()
  auditLog.length = 0
  denyCount = 0
  allowCount = 0
  effectsWithoutGrant = 0
  ttlClampCount = 0
  mintTimestampsByPlugin.clear()
  grantMapCapDenyCount = 0
  mintRateDenyCount = 0
  MAX_OPEN_GRANTS = 64
  MAX_MINT_RATE_PER_SEC = 8
  resetDurableAuditForTests()
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
    // Operator alert/counter surface for INV-DURABLE-AUDIT-FAIL-CLOSED.
    durableAudit: getDurableAuditStatus(),
    // INV-TTL-BOUNDED operator surface.
    ttl: { clampCount: ttlClampCount, maxTaskTtlMs: MAX_TASK_TTL_MS },
    // INV-GRANT-MAP-CAP operator surface.
    grantMap: {
      openGrants: [...grants.values()].filter((g) => !g.revoked).length,
      maxOpenGrants: MAX_OPEN_GRANTS,
      maxMintRatePerSec: MAX_MINT_RATE_PER_SEC,
      grantMapCapDenyCount,
      mintRateDenyCount,
    },
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
  'ttl-unbounded': 3,
  'grant-map-cap': 2,
  'mint-rate': 2,
  'caps-widen-requires-pin-revision': 3,
  'budget-exceeded': 2,
  'trust-ceiling': 2,
  'resource-not-in-grant': 2,
  policy: 2,
  'provenance-drift': 3,
  'cascade-escalation': 3,
  'breaker-quarantine': 2,
  'breaker-kill': 3,
  'breaker-blocklisted': 3,
  'schema-unwitnessed': 3,
  'schema-drift': 3,
  'schema-authority-expansion': 3,
  'schema-pin-unattested': 3,
  'schema-pin-locked': 3,
  'schema-missing': 3,
  'inject-undeclared': 2,
  'preload-not-allowlisted': 2,
  'audit-unavailable': 3,
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
  if (sessionUnloaded.has(pluginId)) return false
  if (!PATCH_ENABLED.has(pluginId)) return false
  if (!MANIFEST_CAPS[pluginId]) return false
  return true
}

/** Own-id UI slot (T1 paint). Manifest may omit the slot resource. */
function isOwnUiSlot(pluginId, resource) {
  const r = String(resource || '')
  return r === pluginId || r === `slot:${pluginId}` || r.startsWith(`${pluginId}:`)
}

function sealedPreloadKeys() {
  try {
    const graph = getAdmissionGraph()
    if (graph && Array.isArray(graph.preloadKeys) && graph.preloadKeys.length) {
      return graph.preloadKeys
    }
  } catch {
    /* sealed snapshot unavailable — fall back to the compile-time trio */
  }
  return SEALED_PRELOAD_KEYS
}

/**
 * Session unload of an admitted plugin. Revokes live grants. Does not write
 * patch.yml, preload, or Application Support. Disabled-set rehab is refused.
 */
export function unloadAdmittedPlugin(pluginId) {
  if (!pluginId || typeof pluginId !== 'string') {
    return {
      decision: 'deny',
      reason: 'no-identity',
      side_effect: false,
      wrote_patch_yml: false,
      wrote_dsh_desktop: false,
      revoked: 0,
    }
  }
  if (DISABLED_PLUGINS.has(pluginId)) {
    return {
      decision: 'deny',
      reason: 'plugin-disabled',
      side_effect: false,
      wrote_patch_yml: false,
      wrote_dsh_desktop: false,
      revoked: 0,
    }
  }
  if (!MANIFEST_CAPS[pluginId] && !PATCH_ENABLED.has(pluginId)) {
    return {
      decision: 'deny',
      reason: 'plugin-disabled',
      side_effect: false,
      wrote_patch_yml: false,
      wrote_dsh_desktop: false,
      revoked: 0,
    }
  }
  sessionUnloaded.add(pluginId)
  let revoked = 0
  for (const g of grants.values()) {
    if (g.plugin_id === pluginId && !g.revoked) {
      g.revoked = true
      revoked += 1
    }
  }
  return {
    decision: 'ok',
    plugin_id: pluginId,
    revoked,
    side_effect: false,
    wrote_patch_yml: false,
    wrote_dsh_desktop: false,
  }
}

export function isSessionUnloaded(pluginId) {
  return sessionUnloaded.has(pluginId)
}

const EVOLUTION_FORBIDDEN = new Set(['grant.mutate', 'compose.mutate'])

function evolutionDeny(reason) {
  return {
    decision: 'deny',
    reason,
    side_effect: false,
    wrote_patch_yml: false,
    wrote_dsh_desktop: false,
    applied: false,
  }
}

/**
 * INV-NO-WIDEN: true when every requested effect/resource is already in the pin.
 * @param {string} pluginId
 * @param {string[]} effects
 * @param {string[]} resources
 */
export function sessionCapsSubsetOfPin(pluginId, effects, resources) {
  const base = MANIFEST_CAPS[pluginId]
  if (!base) return false
  const pinEffects = new Set(base.effects || [])
  const pinResources = new Set(base.resources || [])
  for (const e of effects || []) {
    if (!pinEffects.has(e)) return false
  }
  for (const r of resources || []) {
    if (!pinResources.has(r)) return false
  }
  return true
}

/**
 * Effective A_plugin caps = pinned manifest ∪ session ContractEvolution overlay.
 * Pins stay frozen at import. Overlay is session-only and never rehabs DISABLED.
 * INV-NO-WIDEN: overlay beyond the pin is only applied after HITL + pinRevision.
 */
function effectiveCaps(pluginId) {
  const base = MANIFEST_CAPS[pluginId]
  if (!base) return null
  const extra = sessionCaps.get(pluginId)
  if (!extra) return base
  return {
    effects: [...new Set([...base.effects, ...extra.effects])],
    resources: [...new Set([...base.resources, ...extra.resources])],
    inject: base.inject,
    trust_ceiling: base.trust_ceiling,
  }
}

/**
 * Propose a ContractEvolution. Does not apply, does not write disk.
 * Disabled-set rehab is refused. Soft-apply: admitted plugins may evolve later
 * via {@link acceptContractEvolution} + HITL (+ pinRevision when widening).
 */
export function proposeContractEvolution(req) {
  const pluginId = req && typeof req === 'object' ? req.pluginId : null
  if (!pluginId || typeof pluginId !== 'string') return evolutionDeny('no-identity')
  if (DISABLED_PLUGINS.has(pluginId)) return evolutionDeny('plugin-disabled')
  if (sessionUnloaded.has(pluginId) || !MANIFEST_CAPS[pluginId]) {
    return evolutionDeny('plugin-disabled')
  }
  const effects = Array.isArray(req.effects) ? req.effects.map(String) : []
  const resources = Array.isArray(req.resources) ? req.resources.map(String) : []
  if (effects.some((e) => EVOLUTION_FORBIDDEN.has(e))) {
    return evolutionDeny('compose-mutate-forbidden')
  }
  const widen = !sessionCapsSubsetOfPin(pluginId, effects, resources)
  const proposal_id = randomUUID()
  contractProposals.set(proposal_id, {
    proposal_id,
    plugin_id: pluginId,
    effects,
    resources,
    note: typeof req.note === 'string' ? req.note : '',
    widen,
    accepted: false,
  })
  return {
    decision: 'proposed',
    proposal_id,
    plugin_id: pluginId,
    widen,
    side_effect: false,
    wrote_patch_yml: false,
    wrote_dsh_desktop: false,
    applied: false,
  }
}

/**
 * HITL accept of a ContractEvolution. Session overlay only.
 * `hitl` must be the boolean true — body claims are not enough without it.
 * INV-NO-WIDEN: if the proposal widens beyond the pin, also require
 * `pinRevision === true` (HITL alone is not enough). Does not write patch.yml,
 * does not rehab disabled, does not mutate import-time pin constants.
 */
export function acceptContractEvolution(req) {
  if (!req || req.hitl !== true) return evolutionDeny('compose-mutate-forbidden')
  const id = req.proposal_id
  const p = typeof id === 'string' ? contractProposals.get(id) : null
  if (!p) return evolutionDeny('no-identity')
  if (DISABLED_PLUGINS.has(p.plugin_id) || sessionUnloaded.has(p.plugin_id)) {
    return evolutionDeny('plugin-disabled')
  }
  if (!MANIFEST_CAPS[p.plugin_id]) return evolutionDeny('plugin-disabled')
  const widen = p.widen === true || !sessionCapsSubsetOfPin(p.plugin_id, p.effects, p.resources)
  if (widen && req.pinRevision !== true) {
    pushAudit({
      kind: 'contract.widen_denied',
      decision: 'deny',
      reason: 'caps-widen-requires-pin-revision',
      plugin_id: p.plugin_id,
      proposal_id: p.proposal_id,
      ts: Date.now(),
      side_effect: false,
    })
    return evolutionDeny('caps-widen-requires-pin-revision')
  }
  const cur = sessionCaps.get(p.plugin_id) || {
    effects: new Set(),
    resources: new Set(),
    pin_revision: false,
  }
  for (const e of p.effects) {
    if (!EVOLUTION_FORBIDDEN.has(e)) cur.effects.add(e)
  }
  for (const r of p.resources) cur.resources.add(r)
  if (widen) cur.pin_revision = true
  sessionCaps.set(p.plugin_id, cur)
  p.accepted = true
  if (widen) {
    pushAudit({
      kind: 'contract.pin_revision',
      decision: 'ok',
      plugin_id: p.plugin_id,
      proposal_id: p.proposal_id,
      effects: [...p.effects],
      resources: [...p.resources],
      ts: Date.now(),
      side_effect: false,
    })
  }
  return {
    decision: 'ok',
    proposal_id: p.proposal_id,
    plugin_id: p.plugin_id,
    pin_revision: widen,
    side_effect: false,
    wrote_patch_yml: false,
    wrote_dsh_desktop: false,
    applied: true,
  }
}

export function getContractEvolution(proposalId) {
  const p = contractProposals.get(proposalId)
  return p
    ? {
        ...p,
        effects: [...p.effects],
        resources: [...p.resources],
        widen: !!p.widen,
      }
    : null
}

export function getSessionCapsForTests(pluginId) {
  const extra = sessionCaps.get(pluginId)
  if (!extra) return { effects: [], resources: [], pin_revision: false }
  return {
    effects: [...extra.effects],
    resources: [...extra.resources],
    pin_revision: !!extra.pin_revision,
  }
}

/**
 * INV-NO-WIDEN: digest / pin identity change clears session overlays.
 * Call when an admitted plugin's artifact digest changes (reload/upgrade).
 */
export function clearSessionCapsForDigestChange(pluginId) {
  if (!pluginId || typeof pluginId !== 'string') return false
  const had = sessionCaps.has(pluginId)
  sessionCaps.delete(pluginId)
  for (const [id, p] of contractProposals) {
    if (p.plugin_id === pluginId) contractProposals.delete(id)
  }
  if (had) {
    pushAudit({
      kind: 'contract.session_caps_cleared',
      decision: 'ok',
      plugin_id: pluginId,
      reason: 'digest-change',
      ts: Date.now(),
      side_effect: false,
    })
  }
  return had
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

/* ------------------------------------------------------------------ */
/* INV-TTL-BOUNDED (Ola 1 / Bloque 2 item 2.2 — deep half)             */
/* No immortal task grants. Finite positive ttlMs required at mint;    */
/* oversize clamped to MAX_TASK_TTL_MS with audit. Medium/high effects */
/* reject missing (null) / immortal (Infinity, ≤0, non-finite).        */
/* INV-JEV-NEVER-GRANTS: Advisors (Jev/Atena) never live in authorize/mint. */
/* ------------------------------------------------------------------ */

/** Absolute ceiling for any task-grant TTL (ms). Oversize is clamped. */
export const MAX_TASK_TTL_MS = 5 * 60_000

/** Default when caller omits ttlMs (still bounded — never immortal). */
export const DEFAULT_TASK_TTL_MS = 60_000

/**
 * Medium/high for TTL policy: any effect beyond presentation-only ui.slot.
 * Empty effect list is treated as medium/high (fail-closed).
 * @param {string[] | undefined | null} effects
 */
export function effectsRequireBoundedTtl(effects) {
  const list = Array.isArray(effects) ? effects : []
  if (list.length === 0) return true
  return list.some((e) => e !== 'ui.slot')
}

/**
 * True when a stored grant's ttl_ms is finite, positive, and ≤ MAX.
 * @param {any} grant
 */
export function isGrantTtlBounded(grant) {
  if (!grant || typeof grant !== 'object') return false
  const t = grant.ttl_ms
  return typeof t === 'number' && Number.isFinite(t) && t > 0 && t <= MAX_TASK_TTL_MS
}

/**
 * Normalize mint TTL. Rejects missing/immortal for medium-high; clamps oversize.
 * @param {unknown} rawTtlMs
 * @param {string[] | undefined | null} effects
 * @returns {{ ttlMs: number, clamped: boolean, requested: number | null }}
 */
export function boundTaskTtlMs(rawTtlMs, effects) {
  const mediumHigh = effectsRequireBoundedTtl(effects)

  // Omitted undefined → default (bounded). Never immortal by omission.
  if (rawTtlMs === undefined) {
    return { ttlMs: DEFAULT_TASK_TTL_MS, clamped: false, requested: null }
  }
  // Explicit null = missing. Required reject for medium/high; low (ui.slot-only) → default.
  if (rawTtlMs === null) {
    if (mediumHigh) throw new Error('issueTaskGrant: ttl-missing')
    return { ttlMs: DEFAULT_TASK_TTL_MS, clamped: false, requested: null }
  }
  if (typeof rawTtlMs !== 'number' || !Number.isFinite(rawTtlMs) || rawTtlMs <= 0) {
    // Infinity / NaN / ≤0 / non-number → immortal or invalid (always reject).
    throw new Error('issueTaskGrant: ttl-immortal')
  }
  if (rawTtlMs > MAX_TASK_TTL_MS) {
    return { ttlMs: MAX_TASK_TTL_MS, clamped: true, requested: rawTtlMs }
  }
  return { ttlMs: rawTtlMs, clamped: false, requested: rawTtlMs }
}

/**
 * Count non-revoked open grants (INV-GRANT-MAP-CAP).
 */
function countOpenGrants() {
  let n = 0
  for (const g of grants.values()) {
    if (!g.revoked) n += 1
  }
  return n
}

/**
 * Per-plugin mint rate window (1s). Returns false if mint would exceed rate.
 * @param {string} pluginId
 * @param {number} now
 */
function noteMintOrRateDeny(pluginId, now) {
  const windowMs = 1000
  const stamps = mintTimestampsByPlugin.get(pluginId) || []
  const fresh = stamps.filter((t) => now - t < windowMs)
  if (fresh.length >= MAX_MINT_RATE_PER_SEC) {
    mintTimestampsByPlugin.set(pluginId, fresh)
    return false
  }
  fresh.push(now)
  mintTimestampsByPlugin.set(pluginId, fresh)
  return true
}

/**
 * Issue a short-lived task grant (host/HITL only — not from untrusted data).
 * INV-TTL-BOUNDED: ttlMs is clamped to MAX_TASK_TTL_MS; immortal/missing rejected.
 * INV-GRANT-MAP-CAP: openGrants ≤ MAX_OPEN_GRANTS; mint rate ≤ MAX_MINT_RATE_PER_SEC / plugin.
 */
export function issueTaskGrant({
  pluginId,
  effects,
  resources,
  ttlMs,
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
  const open = countOpenGrants()
  if (open >= MAX_OPEN_GRANTS) {
    grantMapCapDenyCount += 1
    pushAudit({
      kind: 'grant.map_cap',
      decision: 'deny',
      reason: 'grant-map-cap',
      plugin_id: pluginId,
      open_grants: open,
      max_open_grants: MAX_OPEN_GRANTS,
      ts: Date.now(),
      side_effect: false,
    })
    throw new Error('issueTaskGrant: grant-map-cap')
  }
  const now = Date.now()
  if (!noteMintOrRateDeny(pluginId, now)) {
    mintRateDenyCount += 1
    pushAudit({
      kind: 'grant.mint_rate',
      decision: 'deny',
      reason: 'mint-rate',
      plugin_id: pluginId,
      max_mint_rate_per_sec: MAX_MINT_RATE_PER_SEC,
      ts: now,
      side_effect: false,
    })
    throw new Error('issueTaskGrant: mint-rate')
  }
  const caps = effectiveCaps(pluginId)
  const requested = effects || []
  const eff = requested.filter((e) => caps.effects.includes(e) || (e === 'ui.slot' && caps.effects.length === 0))
  const res = (resources || []).filter(
    (r) =>
      caps.resources.includes(r) ||
      (requested.includes('ui.slot') && isOwnUiSlot(pluginId, r)),
  )
  const bound = boundTaskTtlMs(ttlMs, requested)
  const grant = {
    grant_id: randomUUID(),
    plugin_id: pluginId,
    task_id: taskId || randomUUID(),
    effects: eff,
    resources: res,
    ttl_ms: bound.ttlMs,
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
  if (bound.clamped) {
    ttlClampCount += 1
    pushAudit({
      kind: 'grant.ttl_clamped',
      decision: 'clamp',
      plugin_id: pluginId,
      grant_id: grant.grant_id,
      requested_ttl_ms: bound.requested,
      ttl_ms: bound.ttlMs,
      max_ttl_ms: MAX_TASK_TTL_MS,
      ts: Date.now(),
      side_effect: false,
    })
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
  // In-memory provenance / audit trail always grows (never muted).
  auditLog.push(ev)
  // Durable JSONL under harness home (never dsh-desktop). Each line is
  // sealed with prev_hash + hash (INV-AUDIT-CHAIN / Ola 2.A). Failures are
  // counted — empty .catch(() => {}) is forbidden (INV-DURABLE-AUDIT-FAIL-CLOSED).
  scheduleDurableAppend(ev)
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
    // Preload is TCB, not a plugin grantor. Unknown keys deny specifically.
    if (req.channel && typeof req.channel === 'object' && req.channel.kind === 'preload') {
      const key = typeof req.channel.preloadKey === 'string' ? req.channel.preloadKey : ''
      if (key && !sealedPreloadKeys().includes(key)) {
        return deny(
          'preload-not-allowlisted',
          null,
          req.task_id || null,
          req.effect || null,
          null,
          started,
          monotonic,
        )
      }
      return deny('no-identity', null, req.task_id || null, req.effect || null, null, started, monotonic)
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
    if (sessionUnloaded.has(pluginId)) {
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

    // INV-DURABLE-AUDIT-FAIL-CLOSED: after K consecutive durable append
    // failures, deny NEW effects that need a durable trail. Tip-of-spear:
    // already-admitted ui.slot may continue (do not freeze the UI fleet /
    // mass-unload / mass-revoke). Advisors are never consulted on this gate.
    if (isDurableAuditUnavailable()) {
      const admittedUiFleet = effect.kind === 'ui.slot' && aPluginOk(pluginId)
      if (!admittedUiFleet) {
        return deny(
          'audit-unavailable',
          pluginId,
          req.task_id || null,
          effect,
          null,
          started,
          monotonic,
          {},
          null,
          f2,
        )
      }
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

    // F1.5: MCP schema pin/witness. Fail-closed. Advisory SLM is never consulted.
    // Only mcp__* names; first-party tools are unchanged. Un-witnessed or
    // drifted schemas cannot expand authority through authorize().
    if (
      (effect.kind === 'tool.register' || effect.kind === 'tool.call') &&
      isMcpPublicName(effect.resource)
    ) {
      const pinVerdict = verifyMcpToolSchema({
        publicName: effect.resource,
        schema: effect.schema,
        schemaHash: effect.schema_hash,
      })
      if (!pinVerdict.ok) {
        return deny(
          pinVerdict.reason,
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
    }
    if (effect.kind === 'compose.mutate') {
      return deny(
        'compose-mutate-forbidden',
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
    if (effect.kind === 'grant.mutate') {
      return deny('data-as-control', pluginId, req.task_id || null, effect, null, started, monotonic, {}, trustCtx)
    }
    const hop =
      effect.kind === 'ipc.invoke' ||
      String(effect.resource).includes('send_to_agent') ||
      String(effect.resource).startsWith('hop:')
    if (
      (effect.kind === 'proc.spawn' ||
        effect.kind === 'fs.write' ||
        effect.kind === 'net.fetch' ||
        hop) &&
      (trustIn === 'untrusted' || trustIn === 'plugin-data')
    ) {
      return deny('data-as-control', pluginId, req.task_id || null, effect, null, started, monotonic, {}, trustCtx)
    }

    const injectClaim = req.channel && req.channel.inject
    if (injectClaim != null) {
      const capsInject = (MANIFEST_CAPS[pluginId] && MANIFEST_CAPS[pluginId].inject) || []
      const list = Array.isArray(injectClaim) ? injectClaim : [injectClaim]
      if (list.some((s) => !capsInject.includes(s))) {
        return deny(
          'inject-undeclared',
          pluginId,
          req.task_id || null,
          effect,
          null,
          started,
          monotonic,
          { a_plugin_ok: false },
          trustCtx,
        )
      }
    }

    const caps = effectiveCaps(pluginId)
    const ownSlot =
      effect.kind === 'ui.slot' &&
      isOwnUiSlot(pluginId, effect.resource) &&
      (caps.effects.includes('ui.slot') || caps.effects.length === 0)
    const aPlugin =
      ownSlot ||
      (caps.effects.includes(effect.kind) &&
        (caps.resources.includes(effect.resource) ||
          caps.resources.some((r) => effect.resource.startsWith(r.replace(/\*$/, '')))))

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

    if (
      !grant &&
      ownSlot &&
      (trustIn === 'user' || trustIn === 'host')
    ) {
      grant = issueTaskGrant({
        pluginId,
        effects: ['ui.slot'],
        resources: [effect.resource],
        ttlMs: 60_000,
        trustCeiling: caps.trust_ceiling,
        taskId: req.task_id || undefined,
      })
      grant.delegation = {
        issuer: 'abaco-effect-broker',
        basis: 'explicit.host',
        subject: pluginId,
        on_behalf_of: 'host',
        channel_kind: req.channel.kind,
      }
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
    if (!isGrantTtlBounded(grant)) {
      // Tip-of-spear: never allow a grant that escaped mint without a bound TTL.
      return deny('ttl-unbounded', pluginId, grant.task_id, effect, grant.grant_id, started, monotonic, {}, trustCtx)
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

/* INV-DENY-OBSERVED: every deny increments denyCount and pushAudit. */
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
  let breakerLabel = 'unchanged'
  if (pluginId) {
    try {
      const after = breakerState(pluginId)
      breakerLabel =
        after.level >= BREAKER_LEVELS.QUARANTINE
          ? 'OPEN'
          : after.level === BREAKER_LEVELS.THROTTLE
            ? 'HALF_OPEN'
            : 'CLOSED'
    } catch {
      breakerLabel = 'unchanged'
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
    breaker: breakerLabel,
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
