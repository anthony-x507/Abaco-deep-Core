import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import { projectRoot } from './patch-path'

/**
 * Mirrors `@deepseek-ai/dsh-client-modules` `stripClientSuffix` + `makeRequire`.
 * Seed words and registered factories are the only hits. Trailing `/client` is
 * the sole export-subpath rewrite; `package.json` `exports` are never consulted.
 */
function stripClientSuffix(spec: string): string {
  return spec.endsWith('/client') ? spec.slice(0, -7) : spec
}

function missesModuleTable(
  spec: string,
  seed: Set<string>,
  factories: Set<string>,
): boolean {
  if (seed.has(spec)) return false
  const id = stripClientSuffix(spec)
  return !factories.has(id)
}

const FACTORY_REQUIRE = /require\(\s*(['"])([^'"]+)\1\s*\)/gu
const RELATIVE_OR_FILE = /^(?:\.\.?\/|file:)/u
const SEED_WORD = /^(?:react(?:\/jsx-runtime)?|react-dom(?:\/client)?|@deepseek-ai\/[A-Za-z0-9/_-]+)$/u

async function pluginClientBundles(): Promise<string[]> {
  const packagesDir = path.join(projectRoot, 'packages')
  const entries = await readdir(packagesDir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'dshmarket' || entry.name === 'ppt-runtime') {
      continue
    }
    const client = path.join(packagesDir, entry.name, 'client.js')
    try {
      await readFile(client)
      files.push(client)
    } catch {
      // Host-only packages have no browser factory.
    }
  }
  return files
}

function factoryRequireSpecs(source: string): string[] {
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/^\s*\/\/.*$/gmu, '')
  return [...stripped.matchAll(FACTORY_REQUIRE)].map((match) => match[2] ?? '')
}

describe('client-modules factory require vs package exports', () => {
  const seed = new Set(['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'])
  const factories = new Set(['abaco-analytics'])

  it('relative .js and export-map specifiers miss the table; only /client aliases the package', () => {
    expect(missesModuleTable('./lib/summary.js', seed, factories)).toBe(true)
    expect(missesModuleTable('abaco-analytics/lib/summary', seed, factories)).toBe(true)
    expect(missesModuleTable('abaco-analytics/lib/summary.js', seed, factories)).toBe(true)
    expect(missesModuleTable('abaco-analytics', seed, factories)).toBe(false)
    expect(missesModuleTable('abaco-analytics/client', seed, factories)).toBe(false)
    expect(missesModuleTable('react', seed, factories)).toBe(false)
    expect(stripClientSuffix('abaco-analytics/lib/summary')).toBe('abaco-analytics/lib/summary')
    expect(stripClientSuffix('./lib/summary.js')).toBe('./lib/summary.js')
  })

  it('abaco-analytics factory materializes with only the react seed word', async () => {
    const source = await readFile(
      path.join(projectRoot, 'packages/abaco-analytics/client.js'),
      'utf8',
    )
    let registration:
      | { id: string; factory: (require: (spec: string) => unknown) => unknown }
      | undefined
    vm.runInNewContext(source, {
      window: {
        __ModuleLoader__: {
          load(entry: { id: string; factory: (require: (spec: string) => unknown) => unknown }) {
            registration = entry
          },
        },
      },
    })
    expect(registration?.id).toBe('abaco-analytics')

    const table: Record<string, unknown> = {
      react: {
        createElement: () => null,
        useEffect: () => undefined,
        useState: (value: unknown) => [value, () => undefined],
      },
    }
    const requireSpec = (spec: string) => {
      if (Object.hasOwn(table, spec)) return table[spec]
      throw new Error(
        `client-modules: require("${spec}") missed the module table — not a platform seed word, not a materialized module, and no registered package factory`,
      )
    }
    const exported = registration!.factory(requireSpec) as {
      apply?: unknown
      inject?: unknown
      __test__?: {
        collectFromProps: (props: { useChat: (fn: (chat: unknown) => unknown) => unknown }) => {
          turns: number
          steps: number
          requestCount: number
        }
      }
    }
    expect(typeof exported.apply).toBe('function')
    expect(Array.from(exported.inject as string[])).toEqual(['slots'])
    const collected = exported.__test__!.collectFromProps({
      useChat: (fn) => fn({
        nodes: [{
          kind: 'assistant',
          turn: 2,
          step: 5,
          timing: { stepStartTime: 0, firstTokenTime: 400, completedTime: 1400 },
          usage: { prompt_tokens: 10, completion_tokens: 4 },
        }],
      }),
    })
    expect(collected.turns).toBe(2)
    expect(collected.steps).toBe(5)
    expect(collected.requestCount).toBe(1)
  })

  it('hand-written plugin client factories only require module-table seed words', async () => {
    const offenders: string[] = []
    for (const file of await pluginClientBundles()) {
      const source = await readFile(file, 'utf8')
      for (const spec of factoryRequireSpecs(source)) {
        if (RELATIVE_OR_FILE.test(spec) || !SEED_WORD.test(spec)) {
          offenders.push(`${path.relative(projectRoot, file)}: require("${spec}")`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
