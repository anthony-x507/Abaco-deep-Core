/**
 * Types for the `abaco-context` host plugin (Layer 1: the working window and
 * its summary policy). The loader only reads `name`, `inject`, `apply` and
 * `Config`; everything else is exported for tests and diagnostics.
 */

/** Stable Cordis plugin name. */
export declare const name: 'abaco-context'

/** The preset id this plugin owns. */
export declare const PRESET_ID: 'abaco'

/** The composition default this plugin is willing to replace, once. */
export declare const REPLACED_DEFAULT: 'standard'

/** Marker recording that the one-time default write already happened. */
export declare const DEFAULT_MARKER_FILE: '.abaco-context-default.json'

/** How long the one-time default write waits for the roster's settings scope. */
export declare const SETTINGS_WAIT_MS: 5000

/** How often that wait re-reads the roster while the window is open. */
export declare const SETTINGS_POLL_MS: 25

/** The roster's user preset root inside `$DSH_HOME`. */
export declare const USER_PRESET_DIR: '.agent-presets'

/** The install record kept beside the preset directory. */
export declare const STAMP_FILE: '.abaco-context.json'

/** The file the roster requires in a preset directory. */
export declare const COMPOSITION_FILE: 'agent.cordis.yml'

/** The file the picker reads for the display name. */
export declare const METADATA_FILE: 'preset.yml'

/** The row's resolved configuration. */
export interface AbacoContextConfig {
  dshHome: string
  sourceDir: string
  enabled: boolean
  selectAsDefault: boolean
}

/** What the installer decided, and why. */
export interface PresetInstallPlan {
  action: 'install' | 'update' | 'unchanged' | 'keep' | 'error'
  reason: string
}

/** The install outcome. */
export interface PresetInstallResult extends PresetInstallPlan {
  status: 'install' | 'update' | 'unchanged' | 'kept' | 'failed'
  presetPath?: string
}

/** Apply outcome, including the `disabled` short-circuit. */
export type AbacoContextApplyResult = PresetInstallResult | { status: 'disabled' }

/** Where the shipped copy of the preset lives inside this package. */
export declare function shippedPresetDir(): string

/** Resolve `$DSH_HOME` the way the harness does. */
export declare function resolveDshHome(configured?: string, env?: NodeJS.ProcessEnv): string

/** The marker that stops the default from ever being written twice. */
export declare function defaultMarkerPath(dshHome: string): string

/** Resolve the row's `config` block, defensively. */
export declare function resolveContextConfig(raw: unknown): AbacoContextConfig

/** The outcome of the one-time default write. */
export interface AdoptDefaultOutcome {
  status: 'already-applied' | 'already-selected' | 'unavailable' | 'user-choice-kept' | 'selected' | 'failed'
  current?: string
  reason?: string
}

/**
 * The roster's settings handle, exactly as `agent-presets` publishes it.
 *
 * It is a **property** (`agentPresets.settings`), never a factory: `register`
 * returns this object synchronously, and the roster assigns it from inside its
 * own `ctx.inject(["settings"], …)` callback.
 */
export interface AgentPresetSettingsScope {
  get(): { default?: string }
  watch(callback: (next: { default?: string }, prev: { default?: string }) => void | Promise<void>): () => void
  update(patch: { default?: string }): Promise<void>
  replace(section: { default?: string }): Promise<void>
}

/** The bounded wait for {@link AgentPresetSettingsScope}. */
export interface SettingsWaitOptions {
  /** Window in milliseconds; defaults to {@link SETTINGS_WAIT_MS}. */
  timeoutMs?: number
  /** Re-read interval in milliseconds; defaults to {@link SETTINGS_POLL_MS}. */
  pollMs?: number
  /** Sleep seam, so a test never spends the real window. */
  sleep?: (ms: number) => Promise<void>
}

/** Whether a value is the roster's published settings scope. */
export declare function isSettingsScope(value: unknown): value is AgentPresetSettingsScope

/**
 * Wait, bounded, for the roster to publish its settings scope.
 *
 * Cordis has no availability hook for a property a service assigns later, so
 * the scope itself is the signal; the caller warns when the window closes.
 */
export declare function waitForSettingsScope(
  agentPresets: { settings?: unknown } | undefined,
  options?: SettingsWaitOptions
): Promise<AgentPresetSettingsScope | undefined>

/**
 * Point the roster's default at the ABACO preset, once.
 *
 * The callback is typed `=> void` on purpose: Cordis collects a plugin body's
 * return value as an effect, so a callback that returns a promise settling to a
 * status object is `TypeError: Invalid effect` and fails the whole tree.
 */
export declare function adoptDefault(
  ctx: { inject: (deps: string[], callback: (ctx: unknown) => void) => unknown },
  options: {
    dshHome: string
    logger: { info: (message: string) => void; warn: (message: string) => void }
    settingsWait?: SettingsWaitOptions
  }
): unknown

/** The one-time default write, as a plain awaitable. */
export declare function runAdoptDefault(
  rosterCtx: unknown,
  options: {
    marker: string
    logger: { info: (message: string) => void; warn: (message: string) => void }
    settingsWait?: SettingsWaitOptions
  }
): Promise<AdoptDefaultOutcome>

/** The install work, as a plain awaitable; `apply` is only its Cordis shell. */
export declare function runApply(ctx: unknown, config?: unknown): Promise<AbacoContextApplyResult>

/**
 * Cordis plugin body. Synchronous, and returns nothing — never the outcome and
 * never a promise: a plugin body's return value is collected as an effect, and
 * a status object is not one. Use {@link runApply} to read the outcome.
 */
export declare function apply(ctx: unknown, config?: unknown): void
