import { readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { projectRoot } from './patch-path'

/**
 * The factory `require` injected by `window.__ModuleLoader__.load` looks up
 * the host's frozen platform module table (`packages/client/web/src/platform.ts`
 * in DeepSeek Harness; cited from dshmarket/src/client/primitives.d.ts).
 * Only these specifiers are seeded. Anything else — especially a relative
 * `./lib/…` path — throws:
 *   client-modules: require("…") missed the module table
 *   (build-time externals drift or dynamic dependency)
 *
 * First-party tsdown clients stay safe via `external: CLIENT_EXTERNALS` +
 * `noExternal` (packages/dshmarket/tsdown.config.ts). Handwritten abaco-*
 * client.js files have no such pass, so this scan is the guard.
 */
const TABLE_SEED = /^(?:react|react\/jsx-runtime|react-dom|@deepseek-ai\/.+)$/u
const REQUIRE_CALL = /require\(\s*['"]([^'"]+)['"]\s*\)/gu
const CLIENT_NAMES = new Set(['client.js'])

async function walkClientFiles(dir: string, out: string[] = []): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) {
        continue
      }
      await walkClientFiles(full, out)
      continue
    }
    if (CLIENT_NAMES.has(entry.name) || entry.name.endsWith('/client.js')) {
      out.push(full)
    }
  }
  return out
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/(^|[^:])\/\/[^\n]*/gu, '$1')
}

function factoryRequires(source: string): string[] {
  if (!source.includes('window.__ModuleLoader__.load')) return []
  return [...stripComments(source).matchAll(REQUIRE_CALL)].map((match) => match[1]).filter(Boolean)
}

describe('client module table externals', () => {
  it('handwritten and bundled client factories only require seeded table ids', async () => {
    const packagesDir = path.join(projectRoot, 'packages')
    const files = await walkClientFiles(packagesDir)
    expect(files.length).toBeGreaterThan(5)

    const violations: string[] = []
    for (const file of files) {
      const source = await readFile(file, 'utf8')
      for (const spec of factoryRequires(source)) {
        if (TABLE_SEED.test(spec)) continue
        violations.push(`${path.relative(projectRoot, file)}: require(${JSON.stringify(spec)})`)
      }
    }

    expect(violations, violations.join('\n')).toEqual([])
  })

  it('abaco-analytics client no longer relative-requires lib/summary.js', async () => {
    const clientPath = path.join(projectRoot, 'packages/abaco-analytics/client.js')
    const summaryPath = path.join(projectRoot, 'packages/abaco-analytics/lib/summary.js')
    expect(existsSync(summaryPath)).toBe(true)
    const client = await readFile(clientPath, 'utf8')
    expect(client).toContain("window.__ModuleLoader__.load({")
    expect(client).toContain("require('react')")
    expect(client).toContain('function summarizeChatNodes')
    expect(client).not.toMatch(/require\(\s*['"]\.\/lib\/summary\.js['"]\s*\)/u)
  })
})
