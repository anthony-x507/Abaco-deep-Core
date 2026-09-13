/**
 * F2-W4 · Trust tiers T0–T4 for the 16 native abaco-* plugins + disabled list
 * + capability gate. Pure ESM, zero external dependencies, no network.
 *
 * Ordinal: T4 (broker itself, the TCB) > T3 (net/spawn-grade effects) >
 * T2 (local privileged: fs.write, tool registration, secrets) >
 * T1 (local confined: reads, confined writes, constrained spawn) >
 * T0 (presentation only, no host effects).
 *
 * Higher tier = MORE trusted / MORE privileged. Anything not on this table
 * (third-party, typos, forged ids) is deny-by-default: tierOf -> -1 and every
 * canUseCapability call answers { ok:false, reason:'unknown-plugin' }.
 *
 * The DISABLED set below MIRRORS the broker's DISABLED_PLUGINS export
 * (index.js — rehab = FAIL). It is deliberately a literal copy, not an
 * import: the broker module does filesystem verification at import time,
 * and this module must stay dependency-free. Coherence is enforced by
 * tests/tiers.test.mjs, which asserts set equality against the broker's
 * export. Single-source decision is left to the leader (see worker-tiers.md).
 *
 * @module tiers
 */

/**
 * Trust tier per native plugin, 0..4. Justification per plugin lives in
 * reports/worker-tiers.md and is grounded in each plugin's package.json /
 * index.js / manifest.f1.yml capabilities.
 */
export const TIERS = Object.freeze({
  // T0 — presentation only. Client UI injection, no host effects, no data access.
  'abaco-theme': 0, // design tokens; CSS custom properties; inject-only
  'abaco-agent-status': 0, // "AGENTE TRABAJANDO" pill; inject-only
  'abaco-brand': 0, // brand metadata/taglines/About content; inject-only (DISABLED)
  'abaco-onboarding': 0, // first-run wizard skeleton; no capabilities yet (DISABLED)
  'abaco-cloud-sync': 0, // skeleton; backend lands Fase 3; no capabilities yet (DISABLED)
  'abaco-experimental': 0, // feature flags stub; no effects (DISABLED)

  // T1 — local only, confined. Reads, confined append-only writes, or
  // constrained subprocesses (fixed binary + fixed args, no shell).
  'abaco-observability': 1, // append-only JSONL to own <DSH_HOME>/logs dir; no tools, no net
  'abaco-documents': 1, // client-side extraction (pdfjs/mammoth); sips spawn w/ fixed args

  // T2 — local privileged. General fs.write, tool registration, secrets.
  'abaco-memory': 2, // durable sidecar store + abaco_memory_* agent tools
  'abaco-vault': 2, // durable artifact vault; writeFile/appendFile/mkdir
  'abaco-device-identity': 2, // macOS Keychain-backed identity = secrets (DISABLED)
  'abaco-context': 2, // installs preset into roster's user preset root (fs.write)

  // T3 — effect-grade. External network or subprocess execution, or
  // net-equivalent power (driving a browser, grabbing UI control).
  'abaco-browser': 3, // ~8 agent tools (navigate/click/type/grab_control) = net-equivalent
  'abaco-voice': 3, // pinned manifest: proc.spawn, fs.read/write; multi-provider TTS/STT (net)
  'abaco-mediacion-pilot': 3, // pinned manifest: proc.spawn (fork), fs.read/write; executor cell

  // T4 — the broker itself. The TCB; grant/compose mutation is reserved here.
  'abaco-effect-broker': 4,
})

/**
 * Disabled set — MUST mirror the broker's DISABLED_PLUGINS (index.js).
 * Coherence is asserted by test, not by import (this module stays pure).
 */
export const DISABLED = new Set([
  'abaco-brand',
  'abaco-device-identity',
  'abaco-cloud-sync',
  'abaco-onboarding',
  'abaco-experimental',
])

/**
 * Minimum tier required per capability. Deny-by-default: capabilities not on
 * this table are rejected with reason 'unknown-capability'.
 *
 * Notes:
 * - 'self_modify' requires tier >= 1 (F2 contract rule).
 * - 'proc.spawn.constrained' / 'fs.write.confined' are pilot distinctions for
 *   the two T1 plugins (documents: fixed sips invocation; observability:
 *   append-only writes to its own log dir). General 'proc.spawn'/'fs.write'
 *   stay T3/T2. The leader confirms whether to keep the fine distinction or
 *   collapse to the coarse table (which would move documents->T3,
 *   observability->T2).
 * - 'grant.mutate' / 'compose.mutate' are T4: broker-only, never granted to
 *   admitted plugins in pilot scope.
 */
export const CAPABILITY_MIN_TIER = Object.freeze({
  // T0: presentation / invoking already-registered tools
  'ui.slot': 0,
  'tool.call': 0,
  // T1: local, confined
  'host.fetch': 1,
  'fs.read': 1,
  'fs.write.confined': 1,
  'proc.spawn.constrained': 1,
  self_modify: 1,
  // T2: local privileged
  'tool.register': 2,
  'fs.write': 2,
  'ipc.invoke': 2,
  keychain: 2,
  // T3: effect-grade
  'net.fetch': 3,
  'proc.spawn': 3,
  // T4: broker-only
  'grant.mutate': 4,
  'compose.mutate': 4,
})

/**
 * @param {string} pluginId
 * @returns {0|1|2|3|4|-1} trust tier, or -1 when unknown (deny-by-default)
 */
export function tierOf(pluginId) {
  if (typeof pluginId !== 'string' || pluginId.length === 0) return -1
  const t = TIERS[pluginId]
  return t === undefined ? -1 : t
}

/**
 * @param {string} pluginId
 * @returns {boolean} true only when the id is on the disabled list
 */
export function isDisabled(pluginId) {
  return DISABLED.has(pluginId)
}

/**
 * Capability gate. Order of checks: unknown plugin -> disabled -> unknown
 * capability -> tier insufficient -> allow.
 *
 * @param {string} pluginId
 * @param {string} capability
 * @returns {{ ok: boolean, reason: string }}
 */
export function canUseCapability(pluginId, capability) {
  const tier = tierOf(pluginId)
  if (tier === -1) {
    return { ok: false, reason: 'unknown-plugin' }
  }
  if (isDisabled(pluginId)) {
    return { ok: false, reason: 'plugin-disabled' }
  }
  const minTier = CAPABILITY_MIN_TIER[capability]
  if (minTier === undefined) {
    return { ok: false, reason: 'unknown-capability' }
  }
  if (tier < minTier) {
    return {
      ok: false,
      reason: `tier-insufficient: ${capability} requires tier ${minTier}, ${pluginId} is tier ${tier}`,
    }
  }
  return { ok: true, reason: 'ok' }
}
