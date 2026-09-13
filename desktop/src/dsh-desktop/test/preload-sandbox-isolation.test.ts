import { execFile as execFileCallback } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const execFile = promisify(execFileCallback)
const projectRoot = path.resolve(import.meta.dirname, '..')

/**
 * Every preload the desktop ships, by the `[name].cjs` the preload build emits.
 *
 * `index` is the main window's preload and the one whose death the owner can
 * see: with it gone there is no `dshDesktopDirectoryPicker`, so the folder
 * picker answers "DSH Desktop directory picker bridge is unavailable" and no
 * workspace can ever be created.
 */
const PRELOAD_ENTRIES = ['index', 'windows-menu', 'abaco-browser-chrome'] as const

/**
 * The complete set of specifiers a *sandboxed* preload may pass to `require`.
 *
 * A main-window preload runs with `webPreferences.sandbox: true`, where Electron
 * replaces `require` with its own resolver
 * (`lib/sandboxed_renderer/preload.ts` -> `preloadRequire`), which resolves only
 * the two module maps built in `lib/sandboxed_renderer/index.ts` and otherwise
 * `throw new Error('module not found: ' + id)`.
 *
 * That throw is fatal to the whole preload: Electron calls the compiled preload
 * as a single function (`runPreloadScript` -> `preloadScript(require, process,
 * exports, module, ...)`), so a throw on an early `require` line means every
 * later statement never executes - including the
 * `contextBridge.exposeInMainWorld` calls. A relative `require('./chunks/...')`
 * is exactly such a specifier, which is how a code-split preload turns into a
 * window with no bridges at all and no error the app can see.
 *
 * The list below is not copied from documentation: it is asserted, in
 * "matches the resolver inside the installed Electron", against the two maps
 * read out of the Electron binary that this checkout actually ships.
 */
const SANDBOX_REQUIRE_ALLOWLIST = [
  'electron',
  'electron/common',
  'electron/renderer',
  'events',
  'node:events',
  'timers',
  'node:timers',
  'url',
  'node:url'
].sort()

function requireSpecifiersOf(code: string): { calls: number; specifiers: string[] } {
  const calls = code.match(/require\s*\(/g)?.length ?? 0
  const specifiers = [...code.matchAll(/require\(\s*(['"])([^'"]+)\1\s*\)/g)]
    .map((match) => match[2])
    .filter((specifier): specifier is string => typeof specifier === 'string')
  return { calls, specifiers }
}

/**
 * Resolve the file inside the installed `electron` package that carries the
 * sandboxed renderer/preload runtime.
 *
 * On macOS that runtime is compiled into the Electron Framework binary, not
 * into the small launcher `path.txt` names; on the other platforms the main
 * binary is the framework.
 */
function electronRuntimeFile(): string {
  const electronDir = path.join(projectRoot, 'node_modules', 'electron')
  const launcher = readFileSync(path.join(electronDir, 'path.txt'), 'utf8').trim()
  if (process.platform === 'darwin') {
    return path.join(
      electronDir,
      'dist',
      launcher.replace(
        /Contents\/MacOS\/.*$/,
        'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework'
      )
    )
  }
  return path.join(electronDir, 'dist', launcher)
}

/**
 * Read the module-registry maps out of the installed Electron runtime.
 *
 * The maps are flat `new Map([["<specifier>", <loader>], ...])` literals whose
 * keys are module names, e.g.
 * `[["timers",()=>...],["node:timers",()=>...],["url",...],["node:url",...]]`.
 * A map counts as a registry when every key looks like a module name and at
 * least one key names an Electron or Node module, which keeps unrelated flat
 * maps (Electron also ships `[["sha256",...],["sha384",...]]`) out.
 */
function sandboxRequireAllowlistFromInstalledElectron(): string[] {
  const buffer = readFileSync(electronRuntimeFile())
  const specifier = /^(?:node:)?[a-z][a-z0-9/:_-]*$/
  const registryNames = new Set(['electron', 'events', 'timers', 'url'])
  const union = new Set<string>()
  let from = 0
  for (;;) {
    const start = buffer.indexOf('Map([', from)
    if (start === -1) break
    from = start + 1
    const window = buffer.subarray(start, start + 600).toString('latin1')
    const end = window.indexOf('])')
    if (end === -1) continue
    const body = window.slice('Map(['.length, end)
    if (body.includes('Map(')) continue
    const keys = [...body.matchAll(/\["([^"]+)",/g)]
      .map((match) => match[1])
      .filter((key): key is string => typeof key === 'string')
    if (keys.length < 2) continue
    if (!keys.every((key) => specifier.test(key))) continue
    if (!keys.some((key) => registryNames.has(key) || key.startsWith('node:'))) continue
    for (const key of keys) union.add(key)
  }
  return [...union].sort()
}

describe('sandboxed preload bundles', () => {
  let outDir: string
  let emitted: string[]
  let sources: Map<string, string>

  beforeAll(async () => {
    outDir = await mkdtemp(path.join(tmpdir(), 'dsh-preload-isolation-'))
    // The release build command, restricted to a scratch output directory, so
    // this asserts on real electron-vite output rather than on the config text.
    await execFile(
      process.execPath,
      [
        path.join(projectRoot, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js'),
        'build',
        '--outDir',
        outDir
      ],
      { cwd: projectRoot, maxBuffer: 16 * 1024 * 1024 }
    )
    const preloadOutDir = path.join(outDir, 'preload')
    emitted = (await readdir(preloadOutDir, { withFileTypes: true })).map((entry) =>
      entry.isDirectory() ? `${entry.name}/` : entry.name
    )
    sources = new Map(
      await Promise.all(
        PRELOAD_ENTRIES.map(
          async (entry) =>
            [entry, await readFile(path.join(preloadOutDir, `${entry}.cjs`), 'utf8')] as const
        )
      )
    )
  }, 180_000)

  afterAll(async () => {
    if (outDir) await rm(outDir, { recursive: true, force: true })
  })

  it('emits every preload as one standalone file with no shared chunk directory', () => {
    // A shared chunk is the mechanism that produces the fatal relative require:
    // Rollup extracts a module two entries both import into `chunks/<name>.cjs`
    // and each entry then starts with `require("./chunks/<name>.cjs")`.
    expect(emitted.sort()).toEqual([...PRELOAD_ENTRIES].map((entry) => `${entry}.cjs`).sort())
  })

  it('only requires specifiers the sandboxed preload resolver can resolve', () => {
    const offenders: string[] = []
    for (const entry of PRELOAD_ENTRIES) {
      const code = sources.get(entry) as string
      const { calls, specifiers } = requireSpecifiersOf(code)
      if (calls !== specifiers.length) {
        offenders.push(`${entry}.cjs has a require() call that is not a string literal`)
      }
      for (const specifier of specifiers) {
        if (!SANDBOX_REQUIRE_ALLOWLIST.includes(specifier)) {
          offenders.push(`${entry}.cjs requires "${specifier}"`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('keeps the bridges the main window needs inside the preload body', () => {
    const index = sources.get('index') as string
    // `electron` must stay external; bundling it would delete the only require
    // the sandboxed preload is allowed to make.
    expect(index).toMatch(/require\(\s*(['"])electron\1\s*\)/)
    // And the preload must still reach the bridges, which is what a relative
    // require on an early line silently prevents.
    expect(index).toMatch(/exposeInMainWorld\(\s*(['"])dshDesktopDirectoryPicker\1/)
    expect(index).toMatch(/exposeInMainWorld\(\s*(['"])dshAbacoBrowser\1/)
  })

  it('matches the resolver inside the installed Electron', () => {
    // Anchors the allowlist above to the shipped binary. If Electron changes
    // which modules a sandboxed preload may require, this fails loudly instead
    // of letting the test drift into checking a stale list.
    expect(sandboxRequireAllowlistFromInstalledElectron()).toEqual(SANDBOX_REQUIRE_ALLOWLIST)
  })
})
