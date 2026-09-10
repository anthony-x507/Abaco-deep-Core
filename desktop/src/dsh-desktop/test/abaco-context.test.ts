import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { afterEach, describe, expect, it } from 'vitest'
import {
  apply,
  defaultMarkerPath,
  name,
  PRESET_ID,
  resolveContextConfig,
  runAdoptDefault,
  runApply,
  shippedPresetDir
} from '../packages/abaco-context/index.js'
import {
  fingerprint,
  installAbacoPreset,
  planInstall,
  presetRoot,
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
 * - **Nothing this plugin hands Cordis is an invalid effect.** Cordis collects
 *   each plugin body's return value as an effect — a disposer, `null`/
 *   `undefined`, or a promise settling to one of those — and answers anything
 *   else with `TypeError: Invalid effect`, which fails the entry and the whole
 *   tree. The stand-in context below therefore reproduces that rule instead of
 *   papering over it: the bug this file now guards against reached production
 *   precisely because the stand-in returned the callback's promise where the
 *   real `inject` returns a disposal handle.
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

/**
 * Wait for a condition to hold.
 *
 * `apply` starts its install without returning the promise, deliberately, so a
 * test that wants to observe the finished work waits for its end state instead
 * of awaiting a value nothing is allowed to hand back.
 *
 * @param condition - the predicate to poll.
 * @param label - what is being waited for, for the timeout message.
 */
async function waitFor(condition: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out after 2s waiting for ${label}`)
}

/** A logger that records every line written to it. */
function recordingLogger() {
  const logs: string[] = []
  return {
    logs,
    logger: { info: (message: string) => logs.push(message), warn: (message: string) => logs.push(message) }
  }
}

/** One `agentPresets` settings registration, plus the updates it received. */
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

/** The `rosterCtx` a stand-in `inject` hands the callback. */
function fakeRoster(registrationValue?: { get: () => { default?: string }; update: (patch: { default: string }) => Promise<void> }) {
  return { agentPresets: { settings: () => registrationValue } }
}

/** Whether a value carries a `then`, which is all Cordis's own check looks for. */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false
  return typeof (value as PromiseLike<unknown>).then === 'function'
}

/**
 * Collect a plugin body's return value exactly the way Cordis does.
 *
 * `Fiber._execute` accepts a disposer function, `null`/`undefined`, or a
 * promise settling to one of those; every other value is passed to its
 * `safeCollect`, which throws `TypeError: Invalid effect` and fails the plugin.
 * This is that rule in miniature, so a test can hold the plugin to the contract
 * Cordis actually enforces rather than to a convenient one.
 *
 * @param value - whatever a plugin body returned.
 */
async function collectEffect(value: unknown): Promise<void> {
  const settled = isThenable(value) ? await value : value
  if (typeof settled === 'function' || settled === null || settled === undefined) return
  throw new TypeError('Invalid effect')
}

/**
 * A context stand-in that obeys the contract the real one has.
 *
 * `ctx.inject(deps, callback)` starts the callback as its own plugin body and
 * returns that fiber's wrapper — a disposal handle, never the callback's value.
 * The previous stand-in returned the callback's promise, so `await apply(...)`
 * looked like it settled the default write while the real context would have
 * collected that promise as a disposer and died on `Invalid effect`; 24 green
 * tests and a dead app. It now returns a disposer and *records* what the
 * callback returned, so a test can assert on the shape Cordis would collect.
 */
function fakeContext(registrationValue?: {
  get: () => { default?: string }
  update: (patch: { default: string }) => Promise<void>
}) {
  const { logs, logger } = recordingLogger()
  /** The roster the injected callback receives. */
  const roster = fakeRoster(registrationValue)
  /** What each injected callback returned, as Cordis would collect it. */
  const effects: unknown[] = []
  return {
    logs,
    roster,
    effects,
    ctx: {
      logger,
      inject: (_deps: string[], callback: (ctx: unknown) => unknown) => {
        effects.push(callback(roster))
        // A disposal handle, never the callback's value: that distinction is
        // the whole bug.
        return () => undefined
      }
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
  it('replaces the composition default exactly once', async () => {
    const home = await fakeHome()
    const recorder = registration('standard')
    const { logs, logger } = recordingLogger()
    const roster = fakeRoster(recorder.value)

    const outcome = await runAdoptDefault(roster, { marker: defaultMarkerPath(home), logger })
    expect(outcome).toMatchObject({ status: 'selected' })
    expect(recorder.updates).toEqual([{ default: PRESET_ID }])
    expect(existsSync(defaultMarkerPath(home))).toBe(true)
    expect(logs.some((line) => line.includes('is now the default'))).toBe(true)

    // The marker is what makes the next boot a no-op, so a person who picks a
    // different preset afterwards is never overruled.
    recorder.value.get = () => ({ default: 'cordis' })
    await runAdoptDefault(roster, { marker: defaultMarkerPath(home), logger })
    expect(recorder.updates).toHaveLength(1)
  })

  it('keeps a default the person already chose', async () => {
    const home = await fakeHome()
    const recorder = registration('cordis')
    const { logs, logger } = recordingLogger()

    await runAdoptDefault(fakeRoster(recorder.value), { marker: defaultMarkerPath(home), logger })
    expect(recorder.updates).toHaveLength(0)
    expect(existsSync(defaultMarkerPath(home))).toBe(true)
    expect(logs.some((line) => line.includes('leaving the user'))).toBe(true)
  })

  it('is a no-op when the roster never publishes its settings', async () => {
    const home = await fakeHome()
    const { logs, logger } = recordingLogger()
    // A roster that is up but has no settings registration is a no-op, not a
    // failure — and it must leave no marker behind, so the next boot retries.
    await expect(runAdoptDefault(fakeRoster(undefined), { marker: defaultMarkerPath(home), logger })).resolves.toMatchObject(
      { status: 'unavailable' }
    )
    expect(existsSync(defaultMarkerPath(home))).toBe(false)
  })

  it('survives a settings write that throws', async () => {
    const home = await fakeHome()
    const { logs, logger } = recordingLogger()
    const roster = fakeRoster({
      get: () => ({ default: 'standard' }),
      update: async () => {
        throw new Error('read-only settings')
      }
    })
    const outcome = await runAdoptDefault(roster, { marker: defaultMarkerPath(home), logger })
    expect(outcome).toMatchObject({ status: 'failed' })
    expect(logs.some((line) => line.includes('read-only settings'))).toBe(true)
    expect(existsSync(defaultMarkerPath(home))).toBe(false)
  })

  it('does nothing at all when disabled', async () => {
    const home = await fakeHome()
    const { ctx } = fakeContext(registration('standard').value)
    await expect(runApply(ctx as never, { dshHome: home, enabled: false })).resolves.toEqual({ status: 'disabled' })
    expect(existsSync(presetTarget(home))).toBe(false)
  })

  /**
   * The regression guard for the boot failure this plugin shipped with.
   *
   * `harness.log` recorded: `failed to apply loader entry abaco-context
   * (abaco-context): Invalid effect`, from `safeCollect` inside Cordis's
   * `Fiber._execute`. Two plugin bodies were handing Cordis a value it collects
   * as an effect and then rejects: the callback `inject` starts, which returned
   * `runAdoptDefault`'s promise, and `apply` itself, which was `async` and
   * resolved to the status object. Both are asserted here the way Cordis sees
   * them, so reintroducing either one fails this test instead of the app.
   */
  it('REGRESSION: no plugin body hands Cordis an effect it would reject', async () => {
    const home = await fakeHome()
    const recorder = registration('standard')
    const { ctx, effects } = fakeContext(recorder.value)

    // Body 2 — the row's own entry, the value the loader collects for
    // `abaco-context`. `apply` must return `undefined` *synchronously*: a promise
    // here is an `async apply`, which is what shipped and killed the boot, and a
    // status object would fail `collectEffect` even without one.
    const returned = apply(ctx as never, { dshHome: home })
    expect(returned).toBeUndefined()
    expect(isThenable(returned)).toBe(false)

    // The install is fire-and-forget by that same rule, so wait for its end
    // state — the one-time marker, written after the default write — instead of
    // racing it. This also proves the observable behaviour survived: the preset
    // lands and the default is adopted exactly as before.
    await waitFor(() => existsSync(defaultMarkerPath(home)), 'the default marker')
    expect(existsSync(join(presetTarget(home), 'agent.cordis.yml'))).toBe(true)
    expect(recorder.updates).toEqual([{ default: PRESET_ID }])

    // Body 1 — the callback `inject` starts. Its return value is collected the
    // same way, and it used to be `runAdoptDefault`'s promise.
    expect(effects).toHaveLength(1)
    expect(effects[0]).toBeUndefined()

    for (const effect of effects) {
      // A plugin body may hand Cordis a disposer, `null` or `undefined` — never
      // a thenable settling to a status object.
      expect(isThenable(effect)).toBe(false)
      expect(effect === undefined || effect === null || typeof effect === 'function').toBe(true)
      // And the collector itself agrees: this assertion is what fails with
      // `TypeError: Invalid effect` on either buggy shape.
      await expect(collectEffect(effect)).resolves.toBeUndefined()
    }
  })

  /**
   * The other half of the regression, asserted on the declaration itself.
   *
   * `apply` being `async` was invisible to any assertion that inspected only the
   * *resolved* value, because Cordis inspects the returned promise first. This
   * pins the property that actually distinguishes the fix: what `apply` hands
   * back, synchronously, is not a promise.
   */
  it('REGRESSION: apply is not an async function', () => {
    expect(apply.constructor.name).not.toBe('AsyncFunction')
    // `enabled: false` keeps the fire-and-forget work a pure early return, so
    // this assertion never touches the ambient `$DSH_HOME`.
    expect(isThenable(apply({ logger: { info: () => {}, warn: () => {} } }, { enabled: false }))).toBe(false)
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
