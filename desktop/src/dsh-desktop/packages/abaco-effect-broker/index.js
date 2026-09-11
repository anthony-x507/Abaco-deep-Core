/**
 * F1 Effect Broker (Harness host).
 * authorize() is the ONLY path to protected sinks in the pilot scope.
 * Identity comes from ChannelIdentity — body plugin_id is ignored.
 * Cero Atena (asesor) en authorize. Janice = runtime (plugins) elsewhere.
 * @module abaco-effect-broker
 */

import { createHash, randomUUID } from 'node:crypto'
import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

/** @typedef {'host'|'user'|'plugin-data'|'untrusted'} TrustLabel */
/** @typedef {'ui.slot'|'host.fetch'|'tool.call'|'tool.register'|'ipc.invoke'|'fs.read'|'fs.write'|'net.fetch'|'proc.spawn'|'grant.mutate'|'compose.mutate'} EffectKind */

const TRUST_RANK = { untrusted: 0, 'plugin-data': 1, user: 2, host: 3 }

/** Disabled set — rehab = FAIL. */
export const DISABLED_PLUGINS = new Set([
  'abaco-brand',
  'abaco-device-identity',
  'abaco-cloud-sync',
  'abaco-onboarding',
  'abaco-experimental',
])

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

/** Manifest caps (F1). Pilot is executor — no grant.mutate. */
export const MANIFEST_CAPS = {
  'abaco-voice': {
    effects: ['host.fetch', 'tool.call', 'ui.slot', 'proc.spawn', 'fs.read', 'fs.write'],
    resources: [
      '/api/abaco-voice.local-status',
      '/api/abaco-voice.local-transcribe',
      'bin:mlx_whisper',
      'bin:whisper',
      'bin:ffmpeg',
      'fs:tmpdir',
    ],
    inject: ['connection'],
    trust_ceiling: 'user',
  },
  'abaco-mediacion-pilot': {
    effects: ['proc.spawn', 'fs.read', 'fs.write'],
    resources: ['bin:mlx_whisper', 'bin:whisper', 'bin:ffmpeg', 'fs:tmpdir'],
    inject: [],
    trust_ceiling: 'user',
  },
}

/** @type {Map<string, any>} */
const grants = new Map()
/** @type {any[]} */
const auditLog = []
let denyCount = 0
let allowCount = 0
let effectsWithoutGrant = 0

export function resetBrokerForTests() {
  grants.clear()
  auditLog.length = 0
  denyCount = 0
  allowCount = 0
  effectsWithoutGrant = 0
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
  }
  grants.set(grant.grant_id, grant)
  return grant
}

export function revokeGrant(grantId) {
  const g = grants.get(grantId)
  if (g) g.revoked = true
  return !!g
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
    if (!req || typeof req !== 'object') {
      return deny('no-identity', null, null, null, null, started, monotonic)
    }
    // Ignore forged body plugin_id — only channel.
    const pluginId = resolveIdentity(req.channel)
    if (!pluginId) {
      return deny('no-identity', null, req.task_id || null, req.effect || null, null, started, monotonic)
    }
    if (DISABLED_PLUGINS.has(pluginId)) {
      return deny('plugin-disabled', pluginId, req.task_id || null, req.effect || null, null, started, monotonic)
    }
    if (!PATCH_ENABLED.has(pluginId) || !MANIFEST_CAPS[pluginId]) {
      return deny('plugin-disabled', pluginId, req.task_id || null, req.effect || null, null, started, monotonic)
    }

    const effect = req.effect
    if (!effect || !effect.kind || !effect.resource) {
      return deny('effect-not-in-grant', pluginId, req.task_id || null, effect || null, null, started, monotonic)
    }

    // Sinks that data must never drive as control.
    const trustIn = req.trust_in || 'untrusted'
    if (
      (trustIn === 'untrusted' || trustIn === 'plugin-data') &&
      (effect.kind === 'grant.mutate' ||
        effect.kind === 'compose.mutate' ||
        effect.kind === 'tool.register' ||
        effect.kind === 'proc.spawn' ||
        effect.kind === 'fs.write' ||
        effect.kind === 'net.fetch')
    ) {
      // user/host may spawn; untrusted/plugin-data cannot originate control.
      if (trustIn === 'untrusted' || (trustIn === 'plugin-data' && effect.kind !== 'host.fetch')) {
        if (effect.kind === 'tool.register') {
          return deny('skill-cannot-register-tool', pluginId, req.task_id || null, effect, null, started, monotonic)
        }
        if (effect.kind === 'compose.mutate' || effect.kind === 'grant.mutate') {
          return deny(
            effect.kind === 'compose.mutate' ? 'compose-mutate-forbidden' : 'data-as-control',
            pluginId,
            req.task_id || null,
            effect,
            null,
            started,
            monotonic,
          )
        }
        if (trustIn === 'untrusted') {
          return deny('data-as-control', pluginId, req.task_id || null, effect, null, started, monotonic)
        }
      }
    }

    const caps = MANIFEST_CAPS[pluginId]
    const aPlugin =
      caps.effects.includes(effect.kind) &&
      (caps.resources.includes(effect.resource) ||
        caps.resources.some((r) => effect.resource.startsWith(r.replace(/\*$/, ''))))

    if (!aPlugin) {
      return deny('effect-not-in-grant', pluginId, req.task_id || null, effect, null, started, monotonic, {
        a_plugin_ok: false,
      })
    }

    // Auto-issue ephemeral task grant for host.fetch voice routes when task missing
    // (user mic click = trust user). Still requires authorize before spawn.
    let grant = null
    if (req.grant_id) {
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
    }

    if (!grant) {
      return deny('effect-not-in-grant', pluginId, req.task_id || null, effect, null, started, monotonic, {
        a_tarea_ok: false,
      })
    }
    if (grant.revoked) {
      return deny('grant-revoked', pluginId, grant.task_id, effect, grant.grant_id, started, monotonic)
    }
    if (Date.now() - grant.issued_at > grant.ttl_ms) {
      return deny('ttl-expired', pluginId, grant.task_id, effect, grant.grant_id, started, monotonic)
    }
    if (!grant.effects.includes(effect.kind)) {
      return deny('effect-not-in-grant', pluginId, grant.task_id, effect, grant.grant_id, started, monotonic)
    }
    if (
      !grant.resources.includes(effect.resource) &&
      !grant.resources.some((r) => String(effect.resource).startsWith(String(r)))
    ) {
      return deny('resource-not-in-grant', pluginId, grant.task_id, effect, grant.grant_id, started, monotonic)
    }
    if (TRUST_RANK[trustIn] > TRUST_RANK[grant.trust_ceiling]) {
      // trust_in higher than ceiling means data claims more authority than grant allows
      return deny('trust-ceiling', pluginId, grant.task_id, effect, grant.grant_id, started, monotonic)
    }
    // Actually FIDES: trust_in is label of *data*; if data is untrusted and ceiling is user, spawn already denied above.
    // If trust_in is host and ceiling is user, deny trust-ceiling (data more trusted than grant — odd); keep simple:
    if (TRUST_RANK[trustIn] > TRUST_RANK[grant.trust_ceiling]) {
      return deny('trust-ceiling', pluginId, grant.task_id, effect, grant.grant_id, started, monotonic)
    }
    if (grant.calls_used >= grant.budget.calls) {
      return deny('budget-exceeded', pluginId, grant.task_id, effect, grant.grant_id, started, monotonic)
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
      a_deleg_ok: true,
      a_pol_ok: true,
      side_effect: false,
      budget_after: budgetAfter,
      breaker: 'unchanged',
      trace_id: randomUUID(),
    })
    return { decision: 'allow', grant: { ...grant } }
  } catch {
    return deny('policy', null, req?.task_id || null, req?.effect || null, null, Date.now(), monotonic)
  }
}

function deny(reason, pluginId, taskId, effect, grantId, started, monotonic, flags = {}) {
  denyCount += 1
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
    a_deleg_ok: true,
    a_pol_ok: reason !== 'policy',
    side_effect: false,
    budget_after: null,
    breaker: 'unchanged',
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
