import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { projectRoot } from './patch-path'

const SIBLING_IMPORT = /from\s+['"]\.\.\/([a-z0-9-]+)(?:\/[^'"]+)?['"]/gu
const RUNTIME_SOURCE = /\.(?:js|mjs)$/u
const SKIP_DIR = new Set(['tests', 'test', 'node_modules', 'dist', 'site'])

type Manifest = {
  dependencies?: Record<string, string>
  build?: { files?: string[]; asar?: boolean }
}

async function walkRuntimeFiles(dir: string, out: string[] = []): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIR.has(entry.name) || entry.name.startsWith('.')) continue
      await walkRuntimeFiles(full, out)
      continue
    }
    if (RUNTIME_SOURCE.test(entry.name) && !entry.name.includes('.test.')) {
      out.push(full)
    }
  }
  return out
}

function siblingPackageImports(source: string): string[] {
  const names = new Set<string>()
  for (const match of source.matchAll(SIBLING_IMPORT)) {
    const spec = match[1]
    if (!spec) continue
    const name = spec.split('/')[0]
    if (name) names.add(name)
  }
  return [...names]
}

async function readJson<T>(relative: string): Promise<T> {
  return JSON.parse(await readFile(path.join(projectRoot, relative), 'utf8')) as T
}

async function localPackageNames(): Promise<Set<string>> {
  const names = new Set<string>()
  const packagesDir = path.join(projectRoot, 'packages')
  const entries = await readdir(packagesDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const manifestPath = path.join(packagesDir, entry.name, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { name?: string }
    if (typeof manifest.name === 'string') names.add(manifest.name)
  }
  return names
}

describe('packaged local package closure', () => {
  it('declares every sibling-relative import as a root file: production dependency', async () => {
    const manifest = await readJson<Manifest>('package.json')
    const deps = manifest.dependencies ?? {}
    const localNames = await localPackageNames()
    const packagesDir = path.join(projectRoot, 'packages')
    const required = new Set<string>()

    for (const name of localNames) {
      const pkgDir = path.join(packagesDir, name)
      if (!existsSync(pkgDir)) continue
      for (const file of await walkRuntimeFiles(pkgDir)) {
        const source = await readFile(file, 'utf8')
        for (const sibling of siblingPackageImports(source)) {
          if (localNames.has(sibling)) required.add(sibling)
        }
      }
    }

    expect(required.has('abaco-mcp-schema-pin')).toBe(true)
    expect(required.has('abaco-effect-broker')).toBe(true)

    for (const name of [...required].sort()) {
      expect(
        deps[name],
        `${name} is imported via ../${name} after electron-builder dereferences the file: symlink; it must be a root file: dep so it lands in app/node_modules`
      ).toBe(`file:packages/${name}`)
    }
  })

  it('effect-broker and mediacion-pilot declare the schema-pin file: dependency', async () => {
    const broker = await readJson<{ dependencies?: Record<string, string> }>(
      'packages/abaco-effect-broker/package.json'
    )
    const pilot = await readJson<{ dependencies?: Record<string, string> }>(
      'packages/abaco-mediacion-pilot/package.json'
    )
    expect(broker.dependencies?.['abaco-mcp-schema-pin']).toBe('file:../abaco-mcp-schema-pin')
    expect(pilot.dependencies?.['abaco-mcp-schema-pin']).toBe('file:../abaco-mcp-schema-pin')
    expect(pilot.dependencies?.['abaco-effect-broker']).toBe('file:../abaco-effect-broker')
  })

  it('lockfile materializes sibling packages under node_modules/', async () => {
    const manifest = await readJson<Manifest>('package.json')
    const lock = await readJson<{
      packages: Record<string, { resolved?: string; link?: boolean }>
    }>('package-lock.json')

    const required = ['abaco-mcp-schema-pin', 'abaco-effect-broker', 'abaco-mediacion-pilot']
    for (const name of required) {
      expect(manifest.dependencies?.[name]).toBe(`file:packages/${name}`)
      const location = lock.packages[`node_modules/${name}`]
      expect(location?.resolved, `lockfile missing node_modules/${name}`).toBe(
        `packages/${name}`
      )
      expect(location?.link).toBe(true)
    }
  })

  it('electron-builder still packs node_modules so file: packages reach the .app', async () => {
    const manifest = await readJson<Manifest>('package.json')
    expect(manifest.build?.asar).toBe(false)
    expect(manifest.build?.files).toContain('node_modules/**/*')
  })

  it('after install, node_modules/abaco-mcp-schema-pin sits beside effect-broker', async () => {
    const broker = path.join(projectRoot, 'node_modules/abaco-effect-broker')
    if (!existsSync(broker)) {
      // Fresh tree without npm ci: lockfile + packed-layout import still gate the bug.
      return
    }

    const pin = path.join(projectRoot, 'node_modules/abaco-mcp-schema-pin/index.js')
    const packedPin = path.resolve(broker, '../abaco-mcp-schema-pin/index.js')
    expect(existsSync(pin), 'npm ci did not materialize node_modules/abaco-mcp-schema-pin').toBe(
      true
    )
    expect(packedPin).toBe(pin)
    expect(existsSync(packedPin)).toBe(true)
  })

  it('packed sibling layout can import effect-broker and mediacion-pilot', async () => {
    const staging = await mkdtemp(path.join(tmpdir(), 'abaco-pack-imports-'))
    const nodeModules = path.join(staging, 'node_modules')

    try {
      const toCopy = [
        'abaco-mcp-schema-pin',
        'abaco-effect-broker',
        'abaco-mediacion-pilot',
        'abaco-voice'
      ]
      for (const name of toCopy) {
        const from = path.join(projectRoot, 'packages', name)
        const to = path.join(nodeModules, name)
        await cp(from, to, {
          recursive: true,
          filter: (src) => {
            const rel = path.relative(from, src)
            if (!rel || rel === '.') return true
            const top = rel.split(path.sep)[0]
            return !SKIP_DIR.has(top)
          }
        })
      }

      const brokerUrl = pathToFileURL(
        path.join(nodeModules, 'abaco-effect-broker/index.js')
      ).href
      const pilotUrl = pathToFileURL(
        path.join(nodeModules, 'abaco-mediacion-pilot/index.js')
      ).href
      const pinUrl = pathToFileURL(
        path.join(nodeModules, 'abaco-mcp-schema-pin/index.js')
      ).href

      const broker = (await import(brokerUrl)) as {
        authorize?: unknown
        DISABLED_PLUGINS?: unknown
      }
      const pilot = (await import(pilotUrl)) as {
        name?: string
      }
      const pin = (await import(pinUrl)) as {
        verifyMcpToolSchema?: unknown
        isMcpPublicName?: unknown
      }

      expect(typeof broker.authorize).toBe('function')
      expect(broker.DISABLED_PLUGINS).toBeTruthy()
      expect(pilot.name).toBe('abaco-mediacion-pilot')
      expect(typeof pin.verifyMcpToolSchema).toBe('function')
      expect(typeof pin.isMcpPublicName).toBe('function')
    } finally {
      await rm(staging, { recursive: true, force: true })
    }
  })
})
