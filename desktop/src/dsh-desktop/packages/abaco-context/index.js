/**
 * `abaco-context` — Layer 1 (the working window and its summary) of the ABACO
 * DEEP HARNES 3-layer context system.
 *
 * ## The problem this closes
 *
 * The harness ships one compaction policy for every deployment: summarize at
 * 80% of the routed model's window and keep 16% verbatim
 * (`dsh-compaction-basic/lib/index.js:15-17`). On a 1M-token route that means a
 * 160k-token verbatim tail and a summary worth at most 8192 tokens — the span
 * to summary ratio runs past 80:1 exactly when the history matters most, and
 * the summary is the piece that decides what is lost forever. Worse, the
 * policy is frozen at construction: `resolveConfig` deep-freezes, `config` is
 * `readonly`, and there is no runtime API, settings namespace or profile-level
 * `compaction:` key anywhere in the tree. The only supported way to change the
 * policy is to mount a different row — and rows live inside a preset
 * composition.
 *
 * So ABACO ships its own preset: a copy of the shipped `standard` composition
 * whose `compaction-basic` and `tool-result-pruner` rows carry a policy tuned
 * for long working sessions, plus the persona that carries the delegation and
 * durable-memory discipline (design §5.3). The whole composition and the exact
 * deltas are documented in `presets/abaco/agent.cordis.yml`.
 *
 * ## What this plugin does at boot
 *
 * 1. Installs (or refreshes, or deliberately leaves alone) that preset into the
 *    roster's user root, `<DSH_HOME>/.agent-presets/abaco/`. The user root is
 *    scanned by the stock roster (`includeUserRoot`), so no engine package is
 *    patched and the preset stays visible and editable in the product's own
 *    preset picker. `lib/preset-installer.js` owns the policy, including the
 *    promise never to overwrite a hand-edited preset.
 * 2. Once, and only after a successful install, records `abaco` as the default
 *    preset in the roster's settings namespace — but only while the user has
 *    not chosen one (the composition default, `standard`). After that one write
 *    the marker file stops us from ever touching the setting again, so whatever
 *    the person picks in the UI wins for good.
 *
 * ## Rules this plugin obeys
 *
 * - **Nothing here can break the boot.** No service is injected, `apply` never
 *   throws, and every filesystem failure degrades to "the stock preset stays
 *   selected" plus a warning.
 * - **No engine package is modified.** The preset is data; the loader rows and
 *   the roster's own roots do the rest.
 * - **The preset is not installed anywhere else.** Writing into the shipped
 *   root inside `node_modules` would be reverted by the next `npm i`, and
 *   shadowing a shipped id is impossible by design (an earlier root wins a
 *   duplicate id).
 *
 * @module abaco-context
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  installAbacoPreset,
  PRESET_ID,
  presetRoot,
  resolveDshHome,
  sweepTemporaries
} from './lib/preset-installer.js'

/** Stable Cordis plugin name. */
export const name = 'abaco-context'

/** The composition default this plugin is willing to replace, once. */
export const REPLACED_DEFAULT = 'standard'

/** Marker recording that the one-time default write already happened. */
export const DEFAULT_MARKER_FILE = '.abaco-context-default.json'

/** Where the shipped copy of the preset lives inside this package. */
export function shippedPresetDir() {
  return fileURLToPath(new URL('./presets/abaco/', import.meta.url))
}

/** The marker that stops the default from ever being written twice. */
export function defaultMarkerPath(dshHome) {
  return join(presetRoot(dshHome), DEFAULT_MARKER_FILE)
}

/**
 * Resolve the row's `config` block, defensively.
 *
 * Every field is optional: an empty row must behave exactly like the documented
 * default, because the row is what ships.
 *
 * @param raw - the untrusted `config` value.
 * @returns the resolved configuration.
 */
export function resolveContextConfig(raw) {
  const config = raw !== null && typeof raw === 'object' ? raw : {}
  return {
    dshHome: resolveDshHome(typeof config.dshHome === 'string' ? config.dshHome : undefined),
    sourceDir: typeof config.sourceDir === 'string' && config.sourceDir.length > 0 ? config.sourceDir : shippedPresetDir(),
    enabled: config.enabled !== false,
    selectAsDefault: config.selectAsDefault !== false
  }
}

/** A logger sink that cannot itself throw, and is silent when none is reachable. */
function safeLogger(ctx) {
  const fallback = { info: () => {}, warn: () => {} }
  try {
    const logger = ctx?.logger
    if (logger !== null && typeof logger === 'object' && typeof logger.warn === 'function') {
      return {
        info: (message) => logger.info(message),
        warn: (message) => logger.warn(message)
      }
    }
  } catch {
    // Reading an uninjected service throws; silence is the right degradation.
  }
  return fallback
}

/** A readable message out of an unknown thrown value. */
function describe(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Whether the one-time default write already happened.
 *
 * @param marker - absolute marker path.
 * @returns true when a well-formed marker exists.
 */
async function defaultAlreadyApplied(marker) {
  try {
    const parsed = JSON.parse(await readFile(marker, 'utf8'))
    return parsed?.applied === true
  } catch {
    return false
  }
}

/**
 * Record that the default write happened, so it never happens again.
 *
 * @param marker - absolute marker path.
 * @param from - the value that was replaced, for the audit trail.
 */
async function recordDefaultApplied(marker, from) {
  await mkdir(dirname(marker), { recursive: true })
  await writeFile(
    marker,
    `${JSON.stringify({ applied: true, presetId: PRESET_ID, replaced: from, at: new Date().toISOString() }, null, 2)}\n`,
    { mode: 0o600 }
  )
}

/**
 * Point the roster's default at the ABACO preset, once.
 *
 * The write waits for the roster to publish (`ctx.inject`), which is also the
 * only moment its settings registration exists. Everything is best-effort: a
 * roster that never appears, a settings document that is read-only, or a user
 * who already chose a preset all end in a log line and no side effect.
 *
 * @param ctx - the plugin context.
 * @param options - resolved config plus the logger.
 * @returns whatever the injected callback returned: real Cordis ignores it, and
 *   a test's stand-in context uses it to await the write deterministically.
 */
export function adoptDefault(ctx, { dshHome, logger }) {
  const marker = defaultMarkerPath(dshHome)
  return ctx.inject(['agentPresets'], (rosterCtx) => runAdoptDefault(rosterCtx, { marker, logger }))
}

/**
 * The one-time default write, as a plain async function so it is directly
 * testable without a Cordis context.
 *
 * @param rosterCtx - the context on which the roster service is available.
 * @param options - the marker path and a logger.
 */
export async function runAdoptDefault(rosterCtx, { marker, logger }) {
  try {
    if (await defaultAlreadyApplied(marker)) return { status: 'already-applied' }
    const registration = rosterCtx.agentPresets?.settings?.()
    if (registration === undefined || typeof registration.update !== 'function') {
      return { status: 'unavailable' }
    }
    const current = registration.get?.()?.default
    if (current === PRESET_ID) {
      await recordDefaultApplied(marker, current)
      return { status: 'already-selected' }
    }
    // Anything other than the composition default is a decision this plugin
    // does not get to overrule — including a deployment that never shipped
    // `standard`. Record and stand down.
    if (current !== undefined && current !== REPLACED_DEFAULT) {
      logger.info(
        `abaco-context: the default preset is "${String(current)}"; leaving the user's choice alone (select "${PRESET_ID}" in the preset picker to use the ABACO policy)`
      )
      await recordDefaultApplied(marker, current)
      return { status: 'user-choice-kept', current }
    }
    await registration.update({ default: PRESET_ID })
    await recordDefaultApplied(marker, current ?? 'composition-default')
    logger.info(`abaco-context: "${PRESET_ID}" is now the default agent preset`)
    return { status: 'selected' }
  } catch (error) {
    // Retried on the next boot: the marker was never written.
    logger.warn(`abaco-context: could not select the ABACO preset as the default: ${describe(error)}`)
    return { status: 'failed', reason: describe(error) }
  }
}

/**
 * Install the preset and, once, make it the default.
 *
 * @param ctx - the host-plane context this row is applied to.
 * @param config - the row's `config` block.
 * @returns the install outcome, so tests and diagnostics can assert on it.
 */
export async function apply(ctx, config) {
  const logger = safeLogger(ctx)
  const resolved = resolveContextConfig(config)
  if (resolved.enabled === false) {
    logger.info('abaco-context: disabled by config; the ABACO preset is not installed')
    return { status: 'disabled' }
  }

  const result = await installAbacoPreset({
    sourceDir: resolved.sourceDir,
    dshHome: resolved.dshHome,
    logger
  })
  await sweepTemporaries(resolved.dshHome)

  if (result.status === 'failed') {
    logger.warn(`abaco-context: the ABACO preset was not installed: ${result.reason}`)
    return result
  }
  logger.info(`abaco-context: ABACO preset ${result.status} at ${result.presetPath} (${result.reason})`)

  if (result.status === 'kept') return result
  // Cordis's `inject` returns a disposer and runs the callback when the roster
  // is up; a stand-in context returns the callback's promise instead, which is
  // what makes this line deterministic under test.
  if (resolved.selectAsDefault) await adoptDefault(ctx, { dshHome: resolved.dshHome, logger })
  return result
}

/* ────────────────────────────────────────────────────────────────────────────
 * Cordis surface (`name`, `apply`), plus the seams `test/abaco-context.test.ts`
 * drives directly. The loader reads only `name`, `inject`, `apply` and
 * `Config`; every other export is inert to it.
 * ──────────────────────────────────────────────────────────────────────────── */

export {
  COMPOSITION_FILE,
  METADATA_FILE,
  PRESET_ID,
  presetRoot,
  presetTarget,
  resolveDshHome,
  stampPath,
  STAMP_FILE,
  USER_PRESET_DIR
} from './lib/preset-installer.js'
