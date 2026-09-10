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
 * ## Why the default write waits (and why it must complain)
 *
 * The roster does not publish its settings scope with its service. `AgentPresets`
 * assigns `this.settings = settingsCtx.settings.register(...)` from inside its
 * **own** `ctx.inject(["settings"], …)` callback
 * (`dsh-agent-presets/lib/index.js:1311`), so `agentPresets` is injectable —
 * and this row's callback runs — while `agentPresets.settings` is still
 * `undefined`. It is a `SettingsScope` **property** (`get`/`watch`/`update`/
 * `replace`), never a factory: calling it is impossible. Reading it once at the
 * first moment the roster is up therefore always failed, and the failure was
 * silent, which is how the defect survived a whole session of work. The wait
 * below is bounded and every way out of it is logged.
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

/**
 * How long the one-time default write waits for the roster's settings scope.
 *
 * The scope lands one microtask after the roster's own `settings` registration
 * is refreshed, so the honest expectation is milliseconds; the window exists to
 * absorb a slow boot, not to be spent.
 */
export const SETTINGS_WAIT_MS = 5000

/** How often that wait re-reads the roster while the window is open. */
export const SETTINGS_POLL_MS = 25

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

/**
 * Whether a value is the roster's published settings scope.
 *
 * `AgentPresets.settings` is a `SettingsScope` object — `get`, `watch`,
 * `update`, `replace` (`dsh-settings/lib/types/index.d.ts`) — and never the
 * factory that a `settings?.()` call site imagines it to be. The check is on
 * the two members this plugin uses, so a stand-in and the real scope agree.
 *
 * @param value - the value read from `agentPresets.settings`.
 * @returns true when the value can be read and written through.
 */
export function isSettingsScope(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.get === 'function' &&
    typeof value.update === 'function'
  )
}

/** Sleep without ever holding the process open. */
function sleepQuietly(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    if (typeof timer.unref === 'function') timer.unref()
  })
}

/**
 * Wait, bounded, for the roster to publish its settings scope.
 *
 * ## Why a bounded re-read, and not an `inject`/`watch`
 *
 * Cordis has no availability hook for a *property a service sets later*, and
 * neither of the two hooks it does have closes this gap:
 *
 * - `ctx.inject(['settings'], …)` finishes when the `settings` **service** is
 *   provided. The roster is refreshed on that same notification
 *   (`ReflectService.notify`, `cordis/lib/index.js:831`), and plugin bodies run
 *   only after `Fiber._reload`'s `await Promise.resolve()`, so our callback can
 *   land in the same round as the roster's — and when the provider was already
 *   composed, the notification has fired before we ever listen. It would also
 *   never run at all in a deployment with no `settings` provider, which is
 *   exactly the case that must still produce a warning.
 * - `internal/service` (`cordis/lib/index.js:848`) fires on service
 *   *provision*, before the roster's own inject callback has assigned the
 *   field, and comes with the same never-fires problem.
 *
 * So the scope itself is the only honest signal. Re-reading it is bounded, the
 * caller warns when the window closes, and the wait costs one unref'd timer
 * that resolves as soon as the field exists.
 *
 * @param agentPresets - the roster service (`rosterCtx.agentPresets`).
 * @param options - `timeoutMs`, `pollMs`, and a `sleep` seam for tests.
 * @returns the scope, or `undefined` when the window closed without one.
 */
export async function waitForSettingsScope(agentPresets, options = {}) {
  const timeoutMs = options.timeoutMs ?? SETTINGS_WAIT_MS
  const pollMs = options.pollMs ?? SETTINGS_POLL_MS
  const sleep = options.sleep ?? sleepQuietly
  const attempts = Math.max(1, Math.ceil(timeoutMs / pollMs))
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const scope = agentPresets?.settings
    if (isSettingsScope(scope)) return scope
    if (attempt + 1 < attempts) await sleep(pollMs)
  }
  return undefined
}

/** A readable message out of an unknown thrown value. */
function describe(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Warn without letting a broken log sink become a plugin failure.
 *
 * The catch handler registered by `adoptDefault` is the last net under async
 * work, so a throw from inside it would surface as an unhandled rejection.
 *
 * @param logger - the resolved logger.
 * @param message - the line to record.
 */
function warnQuietly(logger, message) {
  try {
    logger.warn(message)
  } catch {
    // Nothing can be reported, and reporting it must not cost the boot either.
  }
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
 * `ctx.inject` only gets us to the roster. The scope the write goes through is
 * assigned later, so `runAdoptDefault` waits for it and logs every outcome —
 * including the one where it never appears. Everything is best-effort: a roster
 * that never publishes a scope, a settings document that is read-only, or a
 * user who already chose a preset all end in a log line and no side effect.
 *
 * ## Why the callback returns nothing
 *
 * Cordis collects a plugin body's return value as an **effect**: a disposer
 * function, `null`/`undefined`, or a promise settling to one of those. Anything
 * else reaches `safeCollect`, which throws `TypeError: Invalid effect` and
 * fails the plugin — and with it the whole tree (`harness.log`: "failed to
 * apply loader entry abaco-context"). `runAdoptDefault` settles to a plain
 * status object, so returning its promise is exactly that failure. The work is
 * therefore *started* here and its settlement is owned by this function: caught,
 * logged, never returned. The callback keeps a block body so nothing it
 * evaluates can escape as a value by accident.
 *
 * @param ctx - the plugin context.
 * @param options - resolved config plus the logger.
 * @returns the fiber wrapper `ctx.inject` hands back, which is the disposal
 *   handle Cordis expects a plugin body to produce.
 */
export function adoptDefault(ctx, { dshHome, logger, settingsWait }) {
  const marker = defaultMarkerPath(dshHome)
  return ctx.inject(['agentPresets'], (rosterCtx) => {
    runAdoptDefault(rosterCtx, { marker, logger, settingsWait }).catch((error) => {
      warnQuietly(logger, `abaco-context: the default preset could not be selected: ${describe(error)}`)
    })
  })
}

/**
 * The one-time default write, as a plain async function so it is directly
 * testable without a Cordis context.
 *
 * @param rosterCtx - the context on which the roster service is available.
 * @param options - the marker path, a logger, and the optional wait seam.
 */
export async function runAdoptDefault(rosterCtx, { marker, logger, settingsWait } = {}) {
  const timeoutMs = settingsWait?.timeoutMs ?? SETTINGS_WAIT_MS
  try {
    if (await defaultAlreadyApplied(marker)) return { status: 'already-applied' }
    // `settings` is the roster's `SettingsScope` PROPERTY. It is assigned from
    // inside the roster's own `ctx.inject(["settings"], …)` callback, so it is
    // still `undefined` on the first refresh round that reaches this code: wait
    // for it, and say so out loud if it never arrives.
    const scope = await waitForSettingsScope(rosterCtx?.agentPresets, settingsWait)
    if (scope === undefined) {
      const reason =
        `the agent-presets roster published no settings scope within ${timeoutMs}ms, so the user-layer default could not be written ` +
        '(the roster registers its scope only while a `settings` provider is composed)'
      // Silence here is what hid this defect: a plugin whose whole second job
      // failed without a line anywhere. Every exit below is logged.
      warnQuietly(logger, `abaco-context: "${PRESET_ID}" is installed but NOT selected as the default: ${reason}`)
      return { status: 'unavailable', reason }
    }
    const current = scope.get()?.default
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
    await scope.update({ default: PRESET_ID })
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
 * This is the Cordis plugin body, and it is deliberately **synchronous**.
 *
 * `Fiber._execute` collects the body's return value as an effect: a disposer,
 * `null`/`undefined`, or a promise settling to one of those. An `async` body
 * resolving to the install status object is therefore *exactly* the same defect
 * as the promise `adoptDefault`'s callback used to return — the same
 * `safeCollect`, the same `TypeError: Invalid effect`, the same dead tree. It
 * is true that an `async` body resolving to `undefined` would also satisfy the
 * collector, but that contract then rests on every one of `runApply`'s six
 * return paths; returning nothing at all makes it structural, and it is the
 * reading that matches this module's own rule that `apply` never throws and
 * nothing here can break the boot.
 *
 * The work is started, not awaited: the loader marks the entry started as soon
 * as this returns, and the install lands in the background. The promise is
 * caught here, so a rejection cannot escape as an unhandled rejection (fatal in
 * Node) nor fail the plugin. The trade is that a session opened in the same
 * instant may not see `abaco` in the picker yet; the roster rescans, and
 * `runAdoptDefault`'s marker keeps the default write one-shot either way.
 *
 * @param ctx - the host-plane context this row is applied to.
 * @param config - the row's `config` block.
 * @returns nothing, which is the only value a plugin body may hand Cordis.
 */
export function apply(ctx, config) {
  runApply(ctx, config).catch((error) => {
    // `runApply` absorbs its own failures, so this is the net under the rest:
    // without it a rejection here would be unhandled, and Node answers an
    // unhandled rejection by killing the process.
    warnQuietly(safeLogger(ctx), `abaco-context: the ABACO preset was not installed: ${describe(error)}`)
  })
}

/**
 * The install work, as a plain async function so the outcome stays directly
 * assertable without a Cordis context.
 *
 * @param ctx - the host-plane context this row is applied to.
 * @param config - the row's `config` block.
 * @returns the install outcome, so tests and diagnostics can assert on it.
 */
export async function runApply(ctx, config) {
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
  // `inject` runs the callback once the roster publishes and returns that
  // fiber's wrapper; awaiting it settles as soon as the roster is up, and
  // resolves immediately while the roster is still absent, so a missing roster
  // can never hold the boot open.
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
