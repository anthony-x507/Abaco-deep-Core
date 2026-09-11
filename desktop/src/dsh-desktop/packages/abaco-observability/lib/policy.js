/**
 * The static compaction-policy self-check.
 *
 * ## Why this is here, and what it is not
 *
 * `docs/SPEC-CONTEXT-3-LAYERS.md` §8.5 requires two alerts, and one of them is
 * *"alerta si el motor desactiva la compactación — **nunca silencioso**"*. That
 * failure mode is real and has already bitten this project: the ABACO preset was
 * installed but never governed, and nothing anywhere said so
 * (`docs/HANDOFF-FASE5.md` §2, Bug 2). A deployment whose `compaction-basic` row
 * is configured `auto: false`, whose preset is missing, or whose engine row is
 * not in the composition at all would otherwise look exactly like a healthy one
 * that simply never needed to compact.
 *
 * ## What it can and cannot claim
 *
 * This reads the **preset file on disk** and reports what that *policy document*
 * says. It is a static, boot-time statement — `policySource: 'preset-file'` —
 * and it deliberately does **not** claim that the running engine honours it.
 *
 * It cannot claim that, and the reason is worth writing down rather than
 * papering over: `BasicCompactionEngine` resolves its spec inside
 * `compactIfNeeded` (per routed model) and **never logs the resolved
 * `thresholdTokens` or `retainTokens`**; `compaction/start` carries only
 * `{ compactionId, sourceCommandId?, turn }`
 * (`dsh-compaction-basic/lib/index.js:434-439` in the ABACO bundle at
 * `/Applications/ABACO DEEP HARNES.app/Contents/Resources/app/node_modules/@deepseek-ai`,
 * md5-identical in all three engine copies on this machine). So the *live*
 * resolved policy is not observable from outside the engine at all. What is
 * observable is that compaction **never ran while the context grew**, which the
 * sibling signal in `self_check` reports instead: `compactions: 0` with a
 * non-zero `pressureTokens`. Between the two, a disabled engine is loud from
 * either direction, and neither number is invented.
 *
 * @module abaco-observability/lib/policy
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** The ABACO preset the composition installs and selects. */
export const PRESET_ID = 'abaco'

/** The engine's compaction row inside a preset composition. */
export const COMPACTION_ROW = 'compaction-basic'

/** The engine's pruner row inside a preset composition. */
export const PRUNER_ROW = 'tool-result-pruner'

/** Where the preset lives under a harness home. */
export function presetPath(dshHome, presetId = PRESET_ID) {
  return join(dshHome, '.agent-presets', presetId, 'agent.cordis.yml')
}

/**
 * Read the composed compaction policy as the preset document states it.
 *
 * The parser is intentionally tiny and line-based instead of a YAML dependency:
 * it only needs to answer "is the row present, and what integers does it set",
 * and a full parser would add a dependency to the boot path of a telemetry row
 * for no gain. It is also deliberately tolerant — an unreadable or unexpected
 * file returns `{ found: false, reason }` rather than throwing, because this
 * runs at mount time and a throw here would be fatal to the whole tree.
 *
 * @param options - `{ dshHome, presetId }`.
 * @returns a frozen report. Never throws.
 */
export function readComposedPolicy({ dshHome, presetId = PRESET_ID }) {
  const path = presetPath(dshHome, presetId)
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    return Object.freeze({
      found: false,
      policySource: 'preset-file',
      presetId,
      path,
      reason: `the preset is not readable (${error?.code ?? String(error?.message ?? error)}); the composition default governs`,
      alerts: Object.freeze(['compaction-policy-unreadable'])
    })
  }

  const row = findRow(text, COMPACTION_ROW)
  if (row === undefined) {
    return Object.freeze({
      found: false,
      policySource: 'preset-file',
      presetId,
      path,
      reason: `the preset has no "${COMPACTION_ROW}" row; this profile has no compaction engine at all`,
      alerts: Object.freeze(['compaction-engine-absent'])
    })
  }

  const policy = {
    thresholdRatio: numberAfter(row, 'thresholdRatio'),
    retainRatio: numberAfter(row, 'retainRatio'),
    retainTokens: numberAfter(row, 'retainTokens'),
    maxTokens: numberAfter(row, 'maxTokens'),
    auto: booleanAfter(row, 'auto')
  }
  const alerts = []
  if (policy.auto === false) alerts.push('compaction-disabled')
  // Owner lock (CONTRACT §0 / SPEC §8): 0.90 / 0.12 / 8192, ratios only.
  // Drift must be loud — the same codes `abaco-context/lib/lock.js` uses.
  if (policy.thresholdRatio !== 0.9) alerts.push('policy-lock-threshold')
  if (policy.retainRatio !== 0.12) alerts.push('policy-lock-retain')
  if (policy.maxTokens !== undefined && policy.maxTokens !== 8192) alerts.push('policy-lock-max-tokens')
  if (policy.retainTokens !== undefined && policy.retainTokens !== null) alerts.push('policy-lock-retain-tokens')
  // `resolveCompactSpec` throws when `retainTokens >= thresholdTokens`
  // (`dsh-compaction-basic/lib/index.js:113`), and that throw is FATAL at load.
  // Reporting the pair here is the cheapest way for the operator to see it
  // before the engine does.
  if (policy.retainRatio !== undefined && policy.thresholdRatio !== undefined && policy.retainRatio >= policy.thresholdRatio) {
    alerts.push('policy-ratio-invalid')
  }

  return Object.freeze({
    found: true,
    policySource: 'preset-file',
    presetId,
    path,
    engineRowFound: true,
    prunerRowFound: findRow(text, PRUNER_ROW) !== undefined,
    policy: Object.freeze(policy),
    alerts: Object.freeze(alerts)
  })
}

/**
 * Extract one top-level list row by its `- id:` line, up to the next row at the
 * same indentation.
 *
 * @param text - the preset file's text.
 * @param id - the row id to find.
 * @returns the row's own lines, or `undefined` when the row is not present.
 */
export function findRow(text, id) {
  const lines = text.split('\n')
  const startPattern = new RegExp(`^(\\s*)-\\s+id:\\s*['"]?${escapeRegExp(id)}['"]?\\s*$`, 'u')
  for (let index = 0; index < lines.length; index += 1) {
    const match = startPattern.exec(lines[index])
    if (match === null) continue
    const indent = match[1].length
    const row = []
    for (let cursor = index; cursor < lines.length; cursor += 1) {
      if (cursor > index) {
        const line = lines[cursor]
        const nextRow = /^(\s*)-\s+\S/u.exec(line)
        if (nextRow !== null && nextRow[1].length === indent) break
      }
      row.push(lines[cursor])
    }
    return row
  }
  return undefined
}

/** The integer that follows `key:` inside a row, if it is there. */
function numberAfter(row, key) {
  const pattern = new RegExp(`^\\s+${escapeRegExp(key)}:\\s*(-?\\d+(?:\\.\\d+)?)\\s*$`, 'u')
  for (const line of row) {
    const match = pattern.exec(line)
    if (match !== null) {
      const value = Number(match[1])
      if (Number.isFinite(value)) return value
    }
  }
  return undefined
}

/** The boolean that follows `key:` inside a row, if it is there. */
function booleanAfter(row, key) {
  const pattern = new RegExp(`^\\s+${escapeRegExp(key)}:\\s*(true|false)\\s*$`, 'u')
  for (const line of row) {
    const match = pattern.exec(line)
    if (match !== null) return match[1] === 'true'
  }
  return undefined
}

/** Escape a literal for the tiny patterns above. */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}
