import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { afterEach, describe, expect, it } from 'vitest'
import {
  adoptDefault,
  apply,
  defaultMarkerPath,
  name,
  PRESET_ID,
  resolveContextConfig,
  shippedPresetDir
} from '../packages/abaco-context/index.js'
import {
  fingerprint,
  installAbacoPreset,
  planInstall,
  presetTarget,
  readTree,
  resolveDshHome,
  stampPath
} from '../packages/abaco-context/lib/preset-installer.js'
import { projectRoot } from './patch-path'

/**
 * Layer 1 (the working window and its summary policy) contract.
 *
 * The thing under test is the *delivery* of the ABACO preset, because that is
 * where the two invariants live that a unit test can actually hold this plugin
 * to:
 *
 * - **The shipped preset is data the roster will accept.** The composition is a
 *   hand-maintained copy of the shipped `standard` preset, so a test asserts the
 *   deltas (and only the deltas) against the engine's own schema expectations:
 *   every row names an installed package, the compaction group still isolates
 *   its realm, and the policy values are the ones the design specifies.
 * - **A person's edits are never overwritten.** Every branch of the install
 *   policy is asserted, including the two "keep" branches, because the whole
 *   reason a copy is tolerable is that it stops clobbering the moment it is
 *   edited.
 */

const temporary: string[] = []

/** A fresh harness home (`$DSH_HOME`) under the OS temporary directory. */
async function fakeHome(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'abaco-context-'))
  temporary.push(root)
  return root
}

/** A staging copy of the shipped preset, so a test can simulate an upgrade. */
async function stagingCopy(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'abaco-context-src-'))
  temporary.push(root)
  await cp(shippedPresetDir(), root, { recursive: true })
  return root
}

afterEach(async () => {
  while (temporary.length > 0) await rm(temporary.pop() as string, { recursive: true, force: true })
})

/** The bytes of one file, read as text. */
async function text(file: string): Promise<string> {
  return await readFile(file, 'utf8')
}

/** A context stand-in: records logs, and runs the injected callback inline. */
function fakeContext(registration?: {
  get: () => { default?: string }
  update: (patch: { default: string }) => Promise<void>
}) {
  const logs: string[] = []
  return {
    logs,
    ctx: {
      logger: {
        info: (message: string) => logs.push(message),
        warn: (message: string) => logs.push(message)
      },
      inject: (_deps: string[], callback: (ctx: unknown) => unknown) =>
        callback({ agentPresets: { settings: () => registration } })
    }
  }
}

describe('abaco-context: $DSH_HOME resolution', () => {
  it('follows the harness precedence: explicit, then $DSH_HOME, then ~/.dsh', () => {
    expect(resolveDshHome('/tmp/explicit', { DSH_HOME: '/tmp/from-env' })).toBe('/tmp/explicit')
    expect(resolveDshHome(undefined, { DSH_HOME: '/tmp/from-env' })).toBe('/tmp/from-env')
    // A blank override must never resolve the home to the working directory.
    expect(resolveDshHome(undefined, { DSH_HOME: '   ' })).toMatch(/\/\.dsh$/u)
    expect(resolveDshHome(undefined, {})).toMatch(/\/\.dsh$/u)
  })

  it('defaults to the shipped preset and to selection-on', () => {
    const resolved = resolveContextConfig(undefined)
    expect(resolved.enabled).toBe(true)
    expect(resolved.selectAsDefault).toBe(true)
    expect(resolved.sourceDir).toBe(shippedPresetDir())
    // Absolute, and derived from the ambient `$DSH_HOME` when the row names
    // none: this test runs inside a harness whose own DSH_HOME is set, so the
    // expectation must not hard-code a home.
    expect(resolved.dshHome.startsWith('/')).toBe(true)
    expect(resolved.dshHome).toBe(resolveDshHome(undefined))
    expect(resolveContextConfig({ enabled: false }).enabled).toBe(false)
    expect(resolveContextConfig({ sourceDir: '/tmp/elsewhere' }).sourceDir).toBe('/tmp/elsewhere')
    expect(resolveContextConfig({ dshHome: '/tmp/home' }).dshHome).toBe('/tmp/home')
  })
})

describe('abaco-context: install policy', () => {
  const tree = (value: string) => fingerprint([{ path: 'agent.cordis.yml', content: Buffer.from(value) }])

  it('installs when nothing is there, updates only its own unchanged copy', () => {
    const shipped = tree('v1')
    expect(planInstall({ shipped, onDisk: undefined, installed: undefined }).action).toBe('install')
    expect(planInstall({ shipped: tree('v2'), onDisk: tree('v1'), installed: tree('v1') }).action).toBe('update')
    expect(planInstall({ shipped, onDisk: tree('v1'), installed: tree('v1') }).action).toBe('unchanged')
  })

  it('adopts an identical preset it did not write, and keeps a different one', () => {
    expect(planInstall({ shipped: tree('v1'), onDisk: tree('v1'), installed: undefined }).action).toBe('unchanged')
    expect(planInstall({ shipped: tree('v1'), onDisk: tree('other'), installed: undefined }).action).toBe('keep')
  })

  it('stops updating the moment the installed preset is edited by hand', () => {
    const plan = planInstall({ shipped: tree('v2'), onDisk: tree('edited'), installed: tree('v1') })
    expect(plan.action).toBe('keep')
    expect(plan.reason).toContain('edited by hand')
  })

  it('refuses to install an empty package', () => {
    const plan = planInstall({ shipped: fingerprint([]), onDisk: undefined, installed: undefined })
    expect(plan.action).toBe('error')
  })
})

describe('abaco-context: installation on disk', () => {
  it('installs the shipped preset byte-for-byte, then reports unchanged', async () => {
    const home = await fakeHome()
    const first = await installAbacoPreset({ sourceDir: shippedPresetDir(), dshHome: home })
    expect(first.status).toBe('install')
    expect(first.presetPath).toBe(presetTarget(home))

    expect(await text(join(presetTarget(home), 'agent.cordis.yml'))).toBe(
      await text(join(shippedPresetDir(), 'agent.cordis.yml'))
    )
    expect(await text(join(presetTarget(home), 'preset.yml'))).toBe(await text(join(shippedPresetDir(), 'preset.yml')))

    const stamp = JSON.parse(await text(stampPath(home))) as { contentHash: string; files: unknown[] }
    expect(stamp.contentHash).toMatch(/^[0-9a-f]{64}$/u)
    expect(stamp.files).toHaveLength(2)

    // The record lives beside the preset, never inside it: a preset directory is
    // a unit that gets exported and imported.
    expect(existsSync(join(presetTarget(home), '.abaco-context.json'))).toBe(false)

    const second = await installAbacoPreset({ sourceDir: shippedPresetDir(), dshHome: home })
    expect(second.status).toBe('unchanged')
  })

  it('updates its own copy when the packaged preset changes', async () => {
    const home = await fakeHome()
    const staging = await stagingCopy()
    await installAbacoPreset({ sourceDir: staging, dshHome: home })
    const upgraded = `${await text(join(staging, 'agent.cordis.yml'))}\n# upgraded\n`
    await writeFile(join(staging, 'agent.cordis.yml'), upgraded)

    const result = await installAbacoPreset({ sourceDir: staging, dshHome: home })
    expect(result.status).toBe('update')
    expect(await text(join(presetTarget(home), 'agent.cordis.yml'))).toBe(upgraded)
  })

  it('never clobbers a hand-edited preset', async () => {
    const home = await fakeHome()
    await installAbacoPreset({ sourceDir: shippedPresetDir(), dshHome: home })
    const edited = '# my own policy\n'
    await writeFile(join(presetTarget(home), 'agent.cordis.yml'), edited)

    const result = await installAbacoPreset({ sourceDir: shippedPresetDir(), dshHome: home })
    expect(result.status).toBe('kept')
    expect(await text(join(presetTarget(home), 'agent.cordis.yml'))).toBe(edited)
  })

  it('leaves a foreign preset that claimed the id', async () => {
    const home = await fakeHome()
    await mkdir(presetTarget(home), { recursive: true })
    await writeFile(join(presetTarget(home), 'agent.cordis.yml'), '# not ours\n')

    const result = await installAbacoPreset({ sourceDir: shippedPresetDir(), dshHome: home })
    expect(result.status).toBe('kept')
    expect(await text(join(presetTarget(home), 'agent.cordis.yml'))).toBe('# not ours\n')
  })

  it('fails soft when the packaged preset is unreadable', async () => {
    const home = await fakeHome()
    const result = await installAbacoPreset({ sourceDir: join(home, 'missing'), dshHome: home })
    expect(result.status).toBe('failed')
    expect(result.reason).toBeTruthy()
    // Nothing was created, so the roster keeps serving the shipped presets.
    await expect(stat(presetTarget(home))).rejects.toThrow(/ENOENT/u)
  })

  it('ignores an unreadable install record instead of clobbering', async () => {
    const home = await fakeHome()
    await installAbacoPreset({ sourceDir: shippedPresetDir(), dshHome: home })
    await writeFile(stampPath(home), '{ not json')
    const result = await installAbacoPreset({ sourceDir: shippedPresetDir(), dshHome: home })
    // No usable record + identical bytes on disk = adopt, never rewrite blind.
    expect(result.status).toBe('unchanged')
  })
})

describe('abaco-context: selecting the default', () => {
  function registration(current?: string) {
    const updates: { default: string }[] = []
    return {
      updates,
      value: {
        get: () => (current === undefined ? {} : { default: current }),
        update: async (patch: { default: string }) => {
          updates.push(patch)
        }
      }
    }
  }

  it('replaces the composition default exactly once', async () => {
    const home = await fakeHome()
    const recorder = registration('standard')
    const { ctx, logs } = fakeContext(recorder.value)

    const first = await apply(ctx, { dshHome: home })
    expect(first.status).toBe('install')
    expect(recorder.updates).toEqual([{ default: PRESET_ID }])
    expect(existsSync(defaultMarkerPath(home))).toBe(true)
    expect(logs.some((line) => line.includes('is now the default'))).toBe(true)

    // The marker is what makes the next boot a no-op, so a person who picks a
    // different preset afterwards is never overruled.
    recorder.value.get = () => ({ default: 'cordis' })
    await apply(ctx, { dshHome: home })
    expect(recorder.updates).toHaveLength(1)
  })

  it('keeps a default the person already chose', async () => {
    const home = await fakeHome()
    const recorder = registration('cordis')
    const { ctx, logs } = fakeContext(recorder.value)

    await apply(ctx, { dshHome: home })
    expect(recorder.updates).toHaveLength(0)
    expect(existsSync(defaultMarkerPath(home))).toBe(true)
    expect(logs.some((line) => line.includes('leaving the user'))).toBe(true)
  })

  it('is a no-op when the roster never publishes its settings', async () => {
    const home = await fakeHome()
    const { ctx } = fakeContext(undefined)
    await expect(apply(ctx, { dshHome: home })).resolves.toMatchObject({ status: 'install' })
    expect(existsSync(defaultMarkerPath(home))).toBe(false)
  })

  it('survives a settings write that throws', async () => {
    const home = await fakeHome()
    const logs: string[] = []
    const ctx = {
      logger: { info: () => {}, warn: (message: string) => logs.push(message) },
      inject: (_deps: string[], callback: (ctx: unknown) => unknown) =>
        callback({
          agentPresets: {
            settings: () => ({
              get: () => ({ default: 'standard' }),
              update: async () => {
                throw new Error('read-only settings')
              }
            })
          }
        })
    }
    const outcome = await adoptDefault(ctx as never, { dshHome: home, logger: ctx.logger })
    expect(outcome).toMatchObject({ status: 'failed' })
    expect(logs.some((line) => line.includes('read-only settings'))).toBe(true)
    expect(existsSync(defaultMarkerPath(home))).toBe(false)
  })

  it('does nothing at all when disabled', async () => {
    const home = await fakeHome()
    const { ctx } = fakeContext(registration('standard').value)
    await expect(apply(ctx, { dshHome: home, enabled: false })).resolves.toEqual({ status: 'disabled' })
    expect(existsSync(presetTarget(home))).toBe(false)
  })
})

describe('abaco-context: the shipped composition', () => {
  /** The parsed composition rows, including nested group rows. */
  async function rows(): Promise<Record<string, unknown>[]> {
    return parseYaml(await text(join(shippedPresetDir(), 'agent.cordis.yml')), {
      customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => value }]
    }) as Record<string, unknown>[]
  }

  function find(rows: Record<string, unknown>[], id: string): Record<string, unknown> | undefined {
    const walk = (list: Record<string, unknown>[]): Record<string, unknown> | undefined => {
      for (const row of list) {
        if (row.id === id) return row
        if (Array.isArray(row.config)) {
          const nested = walk(row.config as Record<string, unknown>[])
          if (nested !== undefined) return nested
        }
      }
      return undefined
    }
    return walk(rows)
  }

  it('declares the ABACO identity in its metadata', async () => {
    const metadata = parseYaml(await text(join(shippedPresetDir(), 'preset.yml'))) as {
      name: string
      description: string
      order: number
    }
    expect(metadata.name).toBe('ABACO DEEP HARNES')
    expect(metadata.description.length).toBeGreaterThan(40)
    expect(metadata.order).toBe(0)
  })

  it('carries the tuned compaction policy and nothing that would disable it', async () => {
    const list = await rows()
    const compaction = find(list, 'compaction-basic')
    expect(compaction?.name).toBe('@deepseek-ai/dsh-compaction-basic')
    expect(compaction?.config).toEqual({ thresholdRatio: 0.6, retainRatio: 0.08, maxTokens: 16384 })

    // `retainTokens` is an absolute budget validated per routed model at first
    // use; a fixed value silently disables compaction on any smaller window.
    expect(JSON.stringify(list)).not.toContain('retainTokens')

    const pruner = find(list, 'tool-result-pruner')
    expect(pruner?.config).toEqual({ thresholdChars: 6000, headChars: 3000, tailChars: 800 })

    // A ratio-retention policy must stay under the threshold at load time, or
    // `validateRatioRetention` throws and the whole preset is reported broken.
    const { thresholdRatio, retainRatio } = compaction?.config as { thresholdRatio: number; retainRatio: number }
    expect(retainRatio).toBeLessThan(thresholdRatio)
  })

  it('keeps the compaction realm isolated, which the engine rejects otherwise', async () => {
    const group = find(await rows(), 'compaction')
    expect(group?.name).toBe('cordis:group')
    expect(group?.group).toBe(true)
    expect(group?.isolate).toEqual({ compaction: true, toolResultPruner: true })
  })

  it('carries the delegation and memory discipline in the persona', async () => {
    const persona = find(await rows(), 'persona')
    const config = persona?.config as { text: string }
    expect(config.text).toContain('ABACO DEEP HARNES')
    // The placeholders are the plugin's own contract; losing them breaks the
    // prompt for every session on this preset.
    expect(config.text).toContain('{{model}}')
    expect(config.text).toContain('{{cwd}}')
    expect(config.text).toContain('subagent')
    for (const tool of ['abaco_memory_set', 'abaco_memory_get', 'abaco_memory_list']) {
      expect(config.text).toContain(tool)
    }
  })

  it('names only plugins that are installed in this deployment', async () => {
    const names = new Set<string>()
    const collect = (list: Record<string, unknown>[]) => {
      for (const row of list) {
        if (typeof row.name === 'string' && row.name !== 'cordis:group') {
          names.add(row.name.split('/').slice(0, row.name.startsWith('@') ? 2 : 1).join('/'))
        }
        if (Array.isArray(row.config)) collect(row.config as Record<string, unknown>[])
      }
    }
    collect(await rows())
    // The `standard` composition names 23 distinct packages; a copy that lost
    // rows would drop below that, which is the failure this guards.
    expect(names.size).toBeGreaterThanOrEqual(23)
    const missing = [...names].filter((entry) => !existsSync(join(projectRoot, 'node_modules', entry, 'package.json')))
    expect(missing).toEqual([])
  })

  it('is reachable through the profile patch and the profile package closure', async () => {
    // The three sites that must agree for the plugin to load at all; the roster
    // row is what the closure test in `desktop-plugin-closure.test.ts` checks
    // against, and the shipped preset travels inside this package.
    expect(name).toBe('abaco-context')
    const patch = await text(join(projectRoot, 'build', 'dsh-desktop.patch.yml'))
    expect(patch).toContain(`- id: ${PRESET_ID}-context`)
  })

  it('reads its own source tree without the install record', async () => {
    const files = await readTree(shippedPresetDir())
    expect(files.map((file) => file.path).sort()).toEqual(['agent.cordis.yml', 'preset.yml'])
  })
})
