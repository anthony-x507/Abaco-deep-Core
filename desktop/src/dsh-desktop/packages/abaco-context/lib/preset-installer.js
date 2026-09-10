/**
 * The installer for the ABACO agent preset (Layer 1 of the 3-layer context
 * system — see `docs/DESIGN-memory-3layer.md` §4).
 *
 * ## Why a copy instead of a config edit
 *
 * `compaction-basic` reads its policy from its composition row and freezes it
 * at construction (`resolveConfig` deep-freezes, `this.config` is `readonly`,
 * and no runtime API, settings namespace or profile-level `compaction:` key
 * exists). The only supported way to *change the policy* is therefore to mount
 * a different row, and the only place that row lives is a preset composition.
 * Shipped preset ids cannot be shadowed by a directory of the same name
 * (`dsh-agent-presets/lib/index.js:1250-1259` — an earlier root wins a
 * duplicate id), so the preset travels under its own id, `abaco`.
 *
 * ## What this module guarantees
 *
 * - **The person's edits win, permanently.** Every install records the hash of
 *   what it wrote. The next boot compares the hash on disk against that record:
 *   if they differ, the file was edited by hand and is left alone from then on.
 *   A preset with our id that we did not write is likewise never touched.
 * - **Nothing here can fail the boot.** Every filesystem operation is inside a
 *   try/catch that returns a status instead of throwing; the caller logs it.
 * - **Writes are atomic.** Each file lands through `tmp + rename` in its own
 *   directory, so a crash mid-install cannot leave a half-written YAML that the
 *   roster would report as a broken preset.
 *
 * @module abaco-context/preset-installer
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'

/** The preset id this installer owns; also the directory name under the root. */
export const PRESET_ID = 'abaco'

/** The roster's user root inside `$DSH_HOME` (`USER_PRESET_DIR` upstream). */
export const USER_PRESET_DIR = '.agent-presets'

/**
 * The install record, kept *beside* the preset directory rather than inside it:
 * a preset directory is a unit that gets copied, exported and imported, and an
 * extra file in it would travel with every export.
 */
export const STAMP_FILE = '.abaco-context.json'

/** Stamp schema version; a mismatch re-installs instead of guessing. */
export const STAMP_VERSION = 1

/** The file the roster requires in a preset directory. */
export const COMPOSITION_FILE = 'agent.cordis.yml'

/** The file the picker reads for the display name. */
export const METADATA_FILE = 'preset.yml'

/**
 * Resolve `$DSH_HOME` the way the Harness does: an explicit path, then
 * `$DSH_HOME` when it is not blank, then `~/.dsh`
 * (`dsh-home-paths/lib/index.js:49-76`).
 *
 * @param configured - explicit override, highest precedence.
 * @param env - environment mapping; defaults to `process.env`.
 * @returns the absolute harness home.
 */
export function resolveDshHome(configured, env = process.env) {
  const explicit = typeof configured === 'string' && configured.trim().length > 0 ? configured.trim() : undefined
  if (explicit !== undefined) return resolve(explicit)
  const fromEnv = env !== null && typeof env === 'object' ? env.DSH_HOME : undefined
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) return resolve(fromEnv.trim())
  return resolve(join(homedir(), '.dsh'))
}

/** The user preset root the roster appends LAST (`includeUserRoot`). */
export function presetRoot(dshHome) {
  return join(dshHome, USER_PRESET_DIR)
}

/** `<DSH_HOME>/.agent-presets/abaco` — the directory the roster scans. */
export function presetTarget(dshHome) {
  return join(presetRoot(dshHome), PRESET_ID)
}

/** `<DSH_HOME>/.agent-presets/.abaco-context.json` — our install record. */
export function stampPath(dshHome) {
  return join(presetRoot(dshHome), STAMP_FILE)
}

/**
 * The sha256 of one payload, as hex.
 *
 * @param content - file bytes.
 * @returns the digest.
 */
export function hashContent(content) {
  return createHash('sha256').update(content).digest('hex')
}

/**
 * Read every regular file under `root` into `{ path, content }`, path-sorted.
 *
 * Dotfiles are skipped so the record never depends on incidental editor or OS
 * residue (`.DS_Store`), and the sort makes the resulting hash independent of
 * `readdir` order.
 *
 * @param root - directory to walk; an absent directory yields `[]`.
 * @returns the file list, relative POSIX-ish paths keyed by `sep` of this host.
 */
export async function readTree(root) {
  const found = []
  const walk = async (dir, prefix) => {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries.sort((left, right) => (left.name < right.name ? -1 : 1))) {
      if (entry.name.startsWith('.')) continue
      const absolute = join(dir, entry.name)
      const relativePath = prefix === '' ? entry.name : `${prefix}${sep}${entry.name}`
      if (entry.isDirectory()) {
        await walk(absolute, relativePath)
        continue
      }
      if (!entry.isFile()) continue
      found.push({ path: relativePath, content: await readFile(absolute) })
    }
  }
  try {
    await walk(root, '')
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  return found
}

/**
 * Reduce a file list to the comparable shape the planner and the stamp share.
 *
 * @param files - entries from {@link readTree}.
 * @returns per-file digests plus one digest over the whole set.
 */
export function fingerprint(files) {
  const entries = files
    .map((file) => ({ path: file.path, sha256: hashContent(file.content), bytes: file.content.length }))
    .sort((left, right) => (left.path < right.path ? -1 : 1))
  const contentHash = hashContent(Buffer.from(entries.map((entry) => `${entry.path}:${entry.sha256}`).join('\n')))
  return { files: entries, contentHash }
}

/** Whether two fingerprints describe byte-identical trees. */
function sameFingerprint(left, right) {
  if (left === undefined || right === undefined) return false
  if (left.contentHash !== right.contentHash) return false
  if (left.files.length !== right.files.length) return false
  return left.files.every((entry, index) => entry.path === right.files[index]?.path)
}

/**
 * Decide what to do, given what we ship, what is on disk and what we last wrote.
 *
 * Pure on purpose: the whole policy — including the promise never to clobber a
 * person's edits — is testable without touching a filesystem.
 *
 * @param input - the three fingerprints, each possibly `undefined`.
 * @returns the action plus a human-readable reason for the log.
 */
export function planInstall({ shipped, onDisk, installed }) {
  if (shipped === undefined || shipped.files.length === 0) {
    return { action: 'error', reason: 'the packaged preset is empty or unreadable' }
  }
  if (onDisk === undefined) {
    return { action: 'install', reason: 'no preset with this id exists yet' }
  }
  if (installed === undefined) {
    // Something with our id is already there and we have no record of writing
    // it: either an older install whose record was lost, or a hand-authored
    // preset that claimed the id first. Identical bytes are safe to adopt.
    if (sameFingerprint(shipped, onDisk)) {
      return { action: 'unchanged', reason: 'a matching preset was already present; adopting it' }
    }
    return { action: 'keep', reason: 'a preset with this id exists and was not written by abaco-context; leaving it untouched' }
  }
  if (!sameFingerprint(installed, onDisk)) {
    return { action: 'keep', reason: 'the installed preset was edited by hand; no longer updating it' }
  }
  if (!sameFingerprint(shipped, installed)) {
    return { action: 'update', reason: 'the packaged preset changed since it was installed' }
  }
  return { action: 'unchanged', reason: 'already up to date' }
}

/**
 * Write one file atomically: a sibling temporary, then a rename over the target.
 *
 * @param target - destination path.
 * @param content - bytes to write.
 */
async function writeAtomic(target, content) {
  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.abaco-tmp-${process.pid}`
  await writeFile(temporary, content, { mode: 0o644 })
  await rename(temporary, target)
}

/**
 * Install, update, adopt or deliberately skip the ABACO preset.
 *
 * Never throws: a failure is reported as `status: 'failed'` with the reason, so
 * a read-only or full disk degrades to "the stock preset stays selected".
 *
 * @param options - source directory, harness home and optional logger.
 * @returns the outcome, including the plan's reason.
 */
export async function installAbacoPreset({ sourceDir, dshHome, logger } = {}) {
  const warn = (message) => {
    try {
      logger?.warn?.(message)
    } catch {
      // A logger that throws is not worth failing an install over.
    }
  }
  try {
    if (typeof sourceDir !== 'string' || typeof dshHome !== 'string') {
      return { status: 'failed', action: 'error', reason: 'sourceDir and dshHome are required' }
    }
    const shipped = fingerprint(await readTree(sourceDir))
    let onDisk
    try {
      onDisk = fingerprint(await readTree(presetTarget(dshHome)))
    } catch (error) {
      warn(`abaco-context: could not read the existing preset: ${describe(error)}`)
      onDisk = undefined
    }
    if (onDisk !== undefined && onDisk.files.length === 0) onDisk = undefined

    let installed
    try {
      const raw = await readFile(stampPath(dshHome), 'utf8')
      const parsed = JSON.parse(raw)
      if (parsed?.version === STAMP_VERSION && typeof parsed.contentHash === 'string' && Array.isArray(parsed.files)) {
        installed = { contentHash: parsed.contentHash, files: parsed.files }
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') warn(`abaco-context: unreadable install record: ${describe(error)}`)
      installed = undefined
    }

    const plan = planInstall({ shipped, onDisk, installed })
    if (plan.action === 'error') return { status: 'failed', ...plan }
    if (plan.action === 'keep') {
      warn(`abaco-context: ${plan.reason}`)
      return { status: 'kept', ...plan, presetPath: presetTarget(dshHome) }
    }

    if (plan.action === 'install' || plan.action === 'update') {
      for (const file of await readTree(sourceDir)) {
        await writeAtomic(join(presetTarget(dshHome), file.path), file.content)
      }
    }

    await writeAtomic(
      stampPath(dshHome),
      Buffer.from(
        `${JSON.stringify(
          {
            version: STAMP_VERSION,
            installer: 'abaco-context',
            presetId: PRESET_ID,
            contentHash: shipped.contentHash,
            files: shipped.files,
            installedAt: new Date().toISOString()
          },
          null,
          2
        )}\n`
      )
    )
    return { status: plan.action === 'unchanged' ? 'unchanged' : plan.action, ...plan, presetPath: presetTarget(dshHome) }
  } catch (error) {
    const reason = describe(error)
    warn(`abaco-context: preset install failed: ${reason}`)
    return { status: 'failed', action: 'error', reason }
  }
}

/** Remove the temporaries a hard kill can leave behind next to the preset. */
export async function sweepTemporaries(dshHome) {
  const root = presetTarget(dshHome)
  try {
    const entries = await readdir(root, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.name.includes('.abaco-tmp-')) continue
      await rm(join(root, entry.name), { force: true, recursive: true })
    }
    return true
  } catch {
    return false
  }
}

/** A readable message out of an unknown thrown value. */
function describe(error) {
  return error instanceof Error ? error.message : String(error)
}
