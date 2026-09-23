/**
 * INV-DOWNGRADE-HITL — pure upgrade-direction policy (no installer I/O).
 * Used by plugin-upgrade.ts and node:test without vitest.
 */

function parseSemver(versionStr) {
  const raw = String(versionStr || '').trim().replace(/^v/i, '')
  const m = raw.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/)
  if (!m) return null
  const prerelease = m[4]
    ? m[4].split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p))
    : []
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease,
  }
}

/** @param {string} aStr @param {string} bStr */
export function compareSemver(aStr, bStr) {
  const a = parseSemver(aStr)
  const b = parseSemver(bStr)
  if (!a && !b) return String(aStr).localeCompare(String(bStr))
  if (!a) return -1
  if (!b) return 1
  if (a.major !== b.major) return a.major > b.major ? 1 : -1
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1
  if (a.prerelease.length === 0 && b.prerelease.length > 0) return 1
  if (a.prerelease.length > 0 && b.prerelease.length === 0) return -1
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0
  const len = Math.max(a.prerelease.length, b.prerelease.length)
  for (let i = 0; i < len; i += 1) {
    const aPart = a.prerelease[i]
    const bPart = b.prerelease[i]
    if (aPart === undefined) return -1
    if (bPart === undefined) return 1
    if (aPart === bPart) continue
    const aNum = typeof aPart === 'number'
    const bNum = typeof bPart === 'number'
    if (aNum && !bNum) return -1
    if (!aNum && bNum) return 1
    return aPart > bPart ? 1 : -1
  }
  return 0
}

/**
 * INV-DOWNGRADE-HITL: targetVersion < currentVersion requires allowDowngrade === true.
 * Missing currentVersion is treated as a fresh install (not a downgrade).
 * @param {{ currentVersion?: string, targetVersion: string, allowDowngrade?: boolean }} options
 */
export function assertUpgradeDirection(options) {
  const current = typeof options.currentVersion === 'string' ? options.currentVersion.trim() : ''
  const target = typeof options.targetVersion === 'string' ? options.targetVersion.trim() : ''
  if (!target) {
    return { ok: false, detail: 'downgrade-policy: missing-target-version' }
  }
  if (!current) {
    return { ok: true }
  }
  if (compareSemver(target, current) < 0) {
    if (options.allowDowngrade !== true) {
      return {
        ok: false,
        detail: `downgrade-requires-explicit-grant: target ${target} < current ${current}`,
      }
    }
  }
  return { ok: true }
}
