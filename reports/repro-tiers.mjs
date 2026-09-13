#!/usr/bin/env node
/**
 * F2-W4 · Repro antes/después: trust tiers T0–T4 + capability gate.
 *
 * ANTES (sin tiers): el modelo F1-puro no distingue plugins por privilegio —
 * cualquier plugin admitido (o inventado) podía pedir cualquier capability y
 * el chequeo "legacy" lo concedía todo. Escenario rojo: un plugin DISABLED
 * pidiendo proc.spawn, un plugin desconocido pidiendo net.fetch, y un plugin
 * T0 pidiendo self_modify pasaban sin fricción.
 *
 * DESPUÉS (con tiers.js): canUseCapability aplica tier mínimo por capability,
 * lista de deshabilitados coherente con el broker, y deny-by-default para
 * plugins y capabilities desconocidos.
 *
 * Exit 0 si el ANTES concede lo peligroso y el DESPUÉS lo deniega mientras
 * mantiene lo legítimo.
 */
import { tierOf, isDisabled, canUseCapability } from '../desktop/src/dsh-desktop/packages/abaco-effect-broker/tiers.js'

// --- ANTES: modelo legacy sin tiers (todo lo admitido pasa) ---
function legacyGrant(pluginId, capability) {
  // En F1 el broker verificaba identidad + manifest, pero no había noción de
  // privilegio por plugin: una vez admitido, pedir era pedir.
  return { ok: true, reason: 'legacy: admitted-plugins-can-ask-anything' }
}

const SCENARIOS = [
  {
    name: 'plugin DISABLED pide proc.spawn',
    pluginId: 'abaco-experimental',
    capability: 'proc.spawn',
    expectAfter: { ok: false, reason: 'plugin-disabled' },
  },
  {
    name: 'plugin desconocido pide net.fetch',
    pluginId: 'abaco-evil',
    capability: 'net.fetch',
    expectAfter: { ok: false, reason: 'unknown-plugin' },
  },
  {
    name: 'plugin T0 pide self_modify',
    pluginId: 'abaco-theme',
    capability: 'self_modify',
    expectAfter: { ok: false, reasonPrefix: 'tier-insufficient' },
  },
  {
    name: 'plugin T1 pide proc.spawn general (solo constrained permitido)',
    pluginId: 'abaco-documents',
    capability: 'proc.spawn',
    expectAfter: { ok: false, reasonPrefix: 'tier-insufficient' },
  },
  {
    name: 'legítimo: voice (T3) pide proc.spawn',
    pluginId: 'abaco-voice',
    capability: 'proc.spawn',
    expectAfter: { ok: true, reason: 'ok' },
  },
  {
    name: 'legítimo: vault (T2) pide fs.write',
    pluginId: 'abaco-vault',
    capability: 'fs.write',
    expectAfter: { ok: true, reason: 'ok' },
  },
  {
    name: 'legítimo: observability (T1) pide fs.write.confined',
    pluginId: 'abaco-observability',
    capability: 'fs.write.confined',
    expectAfter: { ok: true, reason: 'ok' },
  },
  {
    name: 'legítimo: theme (T0) pide ui.slot',
    pluginId: 'abaco-theme',
    capability: 'ui.slot',
    expectAfter: { ok: true, reason: 'ok' },
  },
]

let failures = 0
console.log('=== F2-W4 repro: trust tiers ===\n')
console.log('ANTES (sin tiers)                    | DESPUÉS (con tiers.js)')
console.log('-------------------------------------|-------------------------------------')

for (const s of SCENARIOS) {
  const before = legacyGrant(s.pluginId, s.capability)
  const after = canUseCapability(s.pluginId, s.capability)

  let ok = after.ok === s.expectAfter.ok
  if (s.expectAfter.reason !== undefined) ok = ok && after.reason === s.expectAfter.reason
  if (s.expectAfter.reasonPrefix !== undefined) ok = ok && after.reason.startsWith(s.expectAfter.reasonPrefix)
  if (!ok) failures += 1

  const beforeStr = `GRANT (${before.reason.slice(0, 30)}…)`
  const afterStr = after.ok ? `GRANT (${after.reason})` : `DENY (${after.reason.slice(0, 42)})`
  console.log(
    `${s.name}\n  tier=${tierOf(s.pluginId)} disabled=${isDisabled(s.pluginId)}\n` +
      `  antes: ${beforeStr}\n  después: ${afterStr} ${ok ? '✓' : '✗ FAIL'}\n`,
  )
}

console.log('-------------------------------------|-------------------------------------')
if (failures === 0) {
  console.log(`PASS: ${SCENARIOS.length}/${SCENARIOS.length} escenarios — el ANTES concedía todo, el DESPUÉS deniega por tier/disabled/desconocido y mantiene lo legítimo.`)
  process.exit(0)
} else {
  console.error(`FAIL: ${failures} escenario(s) no se comportaron como se esperaba.`)
  process.exit(1)
}
