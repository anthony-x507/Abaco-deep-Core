/**
 * Types for the ABACO preset installer (Layer 1 delivery).
 *
 * The installer is deliberately free of Cordis: it takes a source directory, a
 * `$DSH_HOME` and an optional logger, and reports what it decided instead of
 * throwing.
 */

/** The preset id this installer owns; also the directory name under the root. */
export declare const PRESET_ID: 'abaco'

/** The roster's user root inside `$DSH_HOME` (`USER_PRESET_DIR` upstream). */
export declare const USER_PRESET_DIR: '.agent-presets'

/** The install record, kept beside the preset directory. */
export declare const STAMP_FILE: '.abaco-context.json'

/** Stamp schema version; a mismatch re-installs instead of guessing. */
export declare const STAMP_VERSION: 1

/** The file the roster requires in a preset directory. */
export declare const COMPOSITION_FILE: 'agent.cordis.yml'

/** The file the picker reads for the display name. */
export declare const METADATA_FILE: 'preset.yml'

/** One file read from a tree. */
export interface TreeFile {
  path: string
  content: Buffer
}

/** One file's digest inside a fingerprint. */
export interface FingerprintEntry {
  path: string
  sha256: string
  bytes: number
}

/** A comparable reduction of a tree. */
export interface Fingerprint {
  files: FingerprintEntry[]
  contentHash: string
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

/** A logger sink the installer may be handed. */
export interface InstallerLogger {
  warn?: (message: string) => void
}

/** Resolve `$DSH_HOME` the way the harness does. */
export declare function resolveDshHome(configured?: string, env?: NodeJS.ProcessEnv): string

/** The user preset root the roster appends last. */
export declare function presetRoot(dshHome: string): string

/** `<DSH_HOME>/.agent-presets/abaco` — the directory the roster scans. */
export declare function presetTarget(dshHome: string): string

/** `<DSH_HOME>/.agent-presets/.abaco-context.json` — our install record. */
export declare function stampPath(dshHome: string): string

/** The sha256 of one payload, as hex. */
export declare function hashContent(content: Buffer): string

/** Read every regular file under `root`, path-sorted. */
export declare function readTree(root: string): Promise<TreeFile[]>

/** Reduce a file list to the comparable shape the planner and stamp share. */
export declare function fingerprint(files: readonly TreeFile[]): Fingerprint

/** Decide what to do, given what we ship, what is on disk and what we wrote. */
export declare function planInstall(input: {
  shipped?: Fingerprint
  onDisk?: Fingerprint
  installed?: Fingerprint
}): PresetInstallPlan

/** Install, update, adopt or deliberately skip the ABACO preset. */
export declare function installAbacoPreset(options?: {
  sourceDir?: string
  dshHome?: string
  logger?: InstallerLogger
}): Promise<PresetInstallResult>

/** Remove the temporaries a hard kill can leave behind next to the preset. */
export declare function sweepTemporaries(dshHome: string): Promise<boolean>
