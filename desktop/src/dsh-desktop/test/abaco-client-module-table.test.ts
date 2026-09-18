import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import {
  classifyRequire,
  extractRequireSpecifiers,
  isPlatformSeed,
  materializeRelativeRequires,
  moduleTableMiss,
  remainingRelativeRequires
} from '../scripts/client-module-table.mjs'
import { projectRoot } from './patch-path'

const SIBLING_IMPORT = /from\s+['"]\.\.\/([a-z0-9-]+)(?:\/[^'"]+)?['"]/gu
const ANALYTICS_BOOT_ERROR =
  'failed to import loader entry 8009188ec (abaco-analytics): client-modules: require("./lib/summary.js") missed the module table – not a platform seed word, not a materialized module, and no registered package factory (a build-time externals drift, or a dynamic dependency that did not arrive)'

const SKIP_DIR = new Set(['tests', 'test', 'node_modules', 'dist', 'site'])

type Manifest = {
  dependencies?: Record<string, string>
  build?: { files?: string[]; asar?: boolean }
  exports?: Record<string, string>
}

async function walkClientFactories(dir: string, out: string[] = []): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIR.has(entry.name) || entry.name.startsWith('.')) continue
      await walkClientFactories(full, out)
      continue
    }
    if (entry.name === 'client.js') out.push(full)
  }
  return out
}

function siblingPackageImports(source: string): string[] {
  return [...source.matchAll(SIBLING_IMPORT)].map((match) => match[1]).filter(Boolean)
}

function seedOnlyRequire(id: string): unknown {
  if (isPlatformSeed(id)) {
    return {
      createElement: () => null,
      useEffect: () => undefined,
      useState: (initial: unknown) => [initial, () => undefined]
    }
  }
  throw new Error(moduleTableMiss(id))
}

function loadFactory(source: string): { id?: string; factory: (require: (id: string) => unknown) => unknown } {
  let definition: { id?: string; factory: (require: (id: string) => unknown) => unknown } | undefined
  vm.runInNewContext(source, {
    window: {
      __ModuleLoader__: {
        load: (value: typeof definition) => {
          definition = value
        }
      }
    },
    Symbol,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Math,
    Date,
    Set,
    Map,
    JSON,
    Error,
    RegExp
  })
  if (!definition?.factory) throw new Error('client factory did not register with __ModuleLoader__')
  return definition
}

describe('client module table vs 0.4.22 disk pin', () => {
  it('0.4.22 sibling-import scanner is blind to require("./lib/summary.js")', () => {
    const leaked = `
      import { authorize } from '../abaco-effect-broker/index.js'
      window.__ModuleLoader__.load({
        id: 'abaco-analytics',
        factory: (require) => {
          const { summarizeChatNodes } = require('./lib/summary.js')
          return summarizeChatNodes
        }
      })
    `
    expect(siblingPackageImports(leaked)).toEqual(['abaco-effect-broker'])
    expect(extractRequireSpecifiers(leaked)).toEqual(['./lib/summary.js'])
    expect(classifyRequire('./lib/summary.js')).toBe('relative')
    expect(classifyRequire('react')).toBe('seed')
    expect(classifyRequire('@deepseek-ai/dsh-client-ui-primitives')).toBe('seed')
    expect(isPlatformSeed('./lib/summary.js')).toBe(false)
  })

  it('file-on-disk + exports map + asar:false still miss the module table', async () => {
    const manifest = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8')) as Manifest
    const analytics = JSON.parse(
      await readFile(path.join(projectRoot, 'packages/abaco-analytics/package.json'), 'utf8')
    ) as Manifest
    const summaryPath = path.join(projectRoot, 'packages/abaco-analytics/lib/summary.js')

    expect(manifest.dependencies?.['abaco-analytics']).toBe('file:packages/abaco-analytics')
    expect(manifest.build?.asar).toBe(false)
    expect(manifest.build?.files).toContain('node_modules/**/*')
    expect(analytics.exports?.['./lib/summary']).toBe('./lib/summary.js')
    expect(existsSync(summaryPath)).toBe(true)

    // This is the installed-.app situation: bytes are present, the table is not.
    expect(() => seedOnlyRequire('./lib/summary.js')).toThrowError(moduleTableMiss('./lib/summary.js'))
    expect(moduleTableMiss('./lib/summary.js')).toContain(ANALYTICS_BOOT_ERROR.slice(ANALYTICS_BOOT_ERROR.indexOf('client-modules:')))
  })

  it('materializing the relative require is what would have caught 0.4.22-style disk-only packaging', async () => {
    const staging = await mkdtemp(path.join(tmpdir(), 'abaco-module-table-'))
    try {
      const leaked = `window.__ModuleLoader__.load({
  id: 'abaco-analytics',
  factory: (require) => {
    const module = { exports: {} }
    const React = require('react')
    const { summarizeChatNodes } = require('./lib/summary.js')
    module.exports.apply = () => summarizeChatNodes([])
    module.exports.react = React
    return module.exports
  }
})
`
      const summary = 'export function summarizeChatNodes(nodes) { return { turns: Array.isArray(nodes) ? nodes.length : 0 } }\n'
      await writeFile(path.join(staging, 'summary.js'), summary)

      expect(remainingRelativeRequires(leaked)).toEqual(['./lib/summary.js'])
      expect(() => loadFactory(leaked).factory(seedOnlyRequire)).toThrowError(
        /missed the module table/u
      )

      const materialized = materializeRelativeRequires(leaked, () => summary)
      expect(remainingRelativeRequires(materialized)).toEqual([])
      const plugin = loadFactory(materialized).factory(seedOnlyRequire) as {
        apply: () => { turns: number }
      }
      expect(plugin.apply()).toEqual({ turns: 0 })
    } finally {
      await rm(staging, { recursive: true, force: true })
    }
  })
})

describe('packaged client factories stay on the module table', () => {
  it('every local client.js require() is a platform seed, never a relative lib path', async () => {
    const factories = await walkClientFactories(path.join(projectRoot, 'packages'))
    expect(factories.some((file) => file.endsWith(`${path.sep}abaco-analytics${path.sep}client.js`))).toBe(
      true
    )

    const leftovers: Array<{ file: string; id: string }> = []
    for (const file of factories) {
      const source = await readFile(file, 'utf8')
      if (!source.includes('__ModuleLoader__')) continue
      for (const id of extractRequireSpecifiers(source)) {
        if (classifyRequire(id) !== 'seed') leftovers.push({ file: path.relative(projectRoot, file), id })
      }
    }

    expect(leftovers).toEqual([])
  })

  it('abaco-analytics factory loads when require() only answers platform seeds', async () => {
    const source = await readFile(path.join(projectRoot, 'packages/abaco-analytics/client.js'), 'utf8')
    expect(source).toContain('function summarizeChatNodes')
    expect(source).toContain('function isAnalyticsStripText')
    expect(remainingRelativeRequires(source)).toEqual([])

    const definition = loadFactory(source)
    expect(definition.id).toBe('abaco-analytics')
    const plugin = definition.factory(seedOnlyRequire) as { apply?: unknown; inject?: unknown }
    expect(typeof plugin.apply).toBe('function')
    expect(plugin.inject).toEqual(['slots'])
  })

  it('does not list lib/summary as a seed or bundler external, and stays plugin-safe', async () => {
    const [client, summary, packager, broker, manifestRaw] = await Promise.all([
      readFile(path.join(projectRoot, 'packages/abaco-analytics/client.js'), 'utf8'),
      readFile(path.join(projectRoot, 'packages/abaco-analytics/lib/summary.js'), 'utf8'),
      readFile(path.join(projectRoot, 'scripts/client-module-table.mjs'), 'utf8'),
      readFile(path.join(projectRoot, 'packages/abaco-effect-broker/index.js'), 'utf8'),
      readFile(path.join(projectRoot, 'package.json'), 'utf8')
    ])
    const manifest = JSON.parse(manifestRaw) as Manifest
    const patch = await readFile(path.join(projectRoot, 'build/dsh-desktop.patch.yml'), 'utf8')

    expect(client).not.toMatch(/require\s*\(\s*['"]\.\/lib\/summary\.js['"]\s*\)/u)
    expect(summary).toContain('Do not list this path as a seed or')
    expect(packager).toContain('Listing `lib/*.js` as seeds or bundler externals is the wrong fix')
    expect(manifest.build?.asar).toBe(false)
    expect(broker).toContain('Cero Atena')
    expect(broker).toMatch(/authorize\(\) is the ONLY path/u)
    expect(patch).toContain('abaco-brand, abaco-device-identity, abaco-cloud-sync, abaco-onboarding')
    expect(patch).not.toMatch(/id: abaco-brand\n  disabled: false/u)
  })
})
