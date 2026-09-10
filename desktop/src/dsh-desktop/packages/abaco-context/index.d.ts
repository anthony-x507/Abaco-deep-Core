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

/** Point the roster's default at the ABACO preset, once. */
export declare function adoptDefault(
  ctx: { inject: (deps: string[], callback: (ctx: unknown) => unknown) => unknown },
  options: { dshHome: string; logger: { info: (message: string) => void; warn: (message: string) => void } }
): unknown

/** The one-time default write, as a plain awaitable. */
export declare function runAdoptDefault(
  rosterCtx: unknown,
  options: { marker: string; logger: { info: (message: string) => void; warn: (message: string) => void } }
): Promise<AdoptDefaultOutcome>

/** Install the preset and, once, make it the default. */
export declare function apply(ctx: unknown, config?: unknown): Promise<AbacoContextApplyResult>
