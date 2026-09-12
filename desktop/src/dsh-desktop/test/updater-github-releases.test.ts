import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  GITHUB_STABLE_FEED,
  GITHUB_UPDATE_OWNER,
  GITHUB_UPDATE_REPO
} from '../src/main/update/version-catalog'
import {
  checkForUpdatesLabel,
  updateLaterLabel,
  updateNowLabel
} from '../src/preload/update-view'

const projectRoot = path.resolve(import.meta.dirname, '..')

describe('feat/updater-github-releases DoD', () => {
  it('points the stable feed at GitHub Releases (not generic)', () => {
    expect(GITHUB_STABLE_FEED.provider).toBe('github')
    expect(GITHUB_STABLE_FEED.owner).toBe('anthony-x507')
    expect(GITHUB_STABLE_FEED.repo).toBe('Abaco-deep-Core')
    expect(GITHUB_UPDATE_OWNER).toBe('anthony-x507')
    expect(GITHUB_UPDATE_REPO).toBe('Abaco-deep-Core')
  })

  it('publishes via electron-builder github owner/repo', async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(projectRoot, 'package.json'), 'utf8')
    ) as { build: { publish: Array<Record<string, unknown>>; mac: { notarize?: unknown } } }
    expect(packageJson.build.publish).toEqual([
      { provider: 'github', owner: 'anthony-x507', repo: 'Abaco-deep-Core' }
    ])
    // Candado: do not enable notarize in this slice.
    expect(packageJson.build.mac.notarize).toBe(false)
  })

  it('shows Ahora / Más tarde / Buscar strings and wires download→install', async () => {
    expect(updateNowLabel('es')).toBe('Actualizar ahora')
    expect(updateLaterLabel('es')).toBe('Más tarde')
    expect(checkForUpdatesLabel('es')).toContain('Buscar')

    const preload = await readFile(path.join(projectRoot, 'src/preload/index.ts'), 'utf8')
    expect(preload).toContain('updateNowLabel')
    expect(preload).toContain('updateLaterLabel')
    expect(preload).toContain("ipcRenderer.invoke('updates:download')")
    expect(preload).toContain("ipcRenderer.invoke('updates:install')")
    expect(preload).toContain('installWhenReady')
    expect(preload).not.toMatch(/ipcRenderer\.invoke\('updates:[a-z-]+:[a-z-]+'/)
  })

  it('keeps F1 authorize path intact (voice/broker/pilot untouched)', async () => {
    const voice = await readFile(path.join(projectRoot, 'packages/abaco-voice/index.js'), 'utf8')
    expect(voice).toContain('authorize(')
    expect(voice).not.toMatch(/\bspawn\s*\(/)

    const f1Test = await readFile(
      path.join(projectRoot, 'test/abaco-f1-mediacion-broker.test.ts'),
      'utf8'
    )
    expect(f1Test).toContain("expect(source).toContain('authorize(')")
    expect(f1Test).toContain('packages/abaco-voice/index.js')

    const manager = await readFile(
      path.join(projectRoot, 'src/main/update/update-manager.ts'),
      'utf8'
    )
    expect(manager).not.toContain('abaco-effect-broker')
    expect(manager).not.toContain('abaco-mediacion-pilot')
    expect(manager).not.toContain('abaco-voice')
  })
})
