import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import type { UpdateStatus } from '../src/shared/contracts'
import {
  checkForUpdatesLabel,
  detectUpdateLocale,
  isUpdateDismissed,
  shouldShowUpdate,
  updateHeadline,
  updateLaterLabel,
  updateMessage,
  updateNowLabel
} from '../src/preload/update-view'

const downloading: UpdateStatus = {
  phase: 'downloading',
  currentVersion: '1.0.0',
  availableVersion: '1.1.0',
  percent: 42.2,
  manual: false
}

const downloaded: UpdateStatus = {
  phase: 'downloaded',
  currentVersion: '1.0.0',
  availableVersion: '1.1.0',
  manual: false
}

describe('desktop update card visibility', () => {
  it('shows automatic downloads but keeps automatic background checks quiet', () => {
    expect(shouldShowUpdate(downloading)).toBe(true)
    expect(
      shouldShowUpdate({ phase: 'checking', currentVersion: '1.0.0', manual: false })
    ).toBe(false)
    expect(
      shouldShowUpdate({ phase: 'checking', currentVersion: '1.0.0', manual: true })
    ).toBe(true)
  })

  it('keeps a dismissed version hidden while its download phase changes', () => {
    expect(isUpdateDismissed(downloading, '1.1.0')).toBe(true)
    expect(isUpdateDismissed({ ...downloading, availableVersion: '1.2.0' }, '1.1.0')).toBe(
      false
    )
  })

  it('dismisses a downloaded update when the user closes the card', () => {
    expect(isUpdateDismissed(downloaded, null)).toBe(false)
    expect(isUpdateDismissed(downloaded, '1.0.0')).toBe(false)
    expect(isUpdateDismissed(downloaded, '1.1.0')).toBe(true)
  })

  it('formats localized progress copy', () => {
    expect(updateMessage(downloading, 'zh')).toBe('正在下载更新 42%')
    expect(updateMessage(downloading, 'en')).toBe('Downloading update 42%')
  })
})

describe('secure update card wiring', () => {
  it('bundles a preload and mounts it without enabling Node in Harness', async () => {
    const [config, main, preload] = await Promise.all([
      readFile('electron.vite.config.ts', 'utf8'),
      readFile('src/main/index.ts', 'utf8'),
      readFile('src/preload/index.ts', 'utf8')
    ])

    expect(config).toContain('preload:')
    expect(main).toContain("preload: join(import.meta.dirname, '../preload/index.cjs')")
    expect(main).toContain('nodeIntegration: false')
    expect(preload).toContain("ipcRenderer.on('updates:status-changed'")
    expect(preload).toContain("ipcRenderer.invoke('updates:install')")
    expect(preload).toContain("'right:20px'")
    expect(preload).toContain("'bottom:20px'")
  })
})

describe('downgrade copy', () => {
  it('names the downgrade in both locales', () => {
    const status: UpdateStatus = {
      phase: 'downloading',
      currentVersion: '1.5.0',
      availableVersion: '1.2.0',
      manual: true,
      downgrade: true,
      percent: 30
    }
    expect(updateHeadline(status, 'zh').title).toContain('降级')
    expect(updateMessage(status, 'zh')).toContain('1.2.0')
    expect(updateHeadline(status, 'en').title.toLowerCase()).toContain('downgrad')
    expect(updateMessage(status, 'en')).toContain('1.2.0')
  })
})

describe('accepting an update is what starts the download', () => {
  it('asks rather than announcing a download already under way', () => {
    const available: UpdateStatus = {
      phase: 'available',
      currentVersion: '0.4.3',
      availableVersion: '0.4.4',
      manual: false
    }
    expect(updateMessage(available, 'zh')).toBe('发现新版本 0.4.4，是否更新？')
    expect(updateMessage(available, 'en')).toBe(
      'ABACO DEEP HARNES 0.4.4 is available. Update now?'
    )
  })
})

describe('about dialog and version selection wiring', () => {
  it('wires about modal with top-right close and version picker alongside check for updates', async () => {
    const [main, preload] = await Promise.all([
      readFile('src/main/index.ts', 'utf8'),
      readFile('src/preload/index.ts', 'utf8')
    ])

    expect(main).toContain("window.webContents.send('desktop:show-about', info)")
    expect(preload).toContain("ipcRenderer.on('desktop:show-about'")
    expect(preload).toContain("zh ? '选择版本' : 'Select version'")
    expect(preload).toContain('checkForUpdatesLabel(locale)')
    expect(preload).toContain("button('×', 'about-close')")
    expect(preload).toContain('mountAbout()')
  })
})

describe('updater DoD labels (Ahora / Más tarde / Buscar)', () => {
  it('exposes ES+EN (and zh) action strings for the banner and settings', () => {
    expect(updateNowLabel('es')).toBe('Actualizar ahora')
    expect(updateLaterLabel('es')).toBe('Más tarde')
    expect(checkForUpdatesLabel('es')).toBe('Buscar updates')
    expect(updateNowLabel('en')).toBe('Update now')
    expect(updateLaterLabel('en')).toBe('Later')
    expect(checkForUpdatesLabel('en')).toBe('Check for updates')
    expect(detectUpdateLocale('es-MX')).toBe('es')
    expect(detectUpdateLocale('en-US')).toBe('en')
  })
})

describe('updater banner wires download then install without new IPC', () => {
  it('uses updateNow/Later helpers and existing updates:* channels only', async () => {
    const preload = await readFile('src/preload/index.ts', 'utf8')
    expect(preload).toContain('updateNowLabel(locale)')
    expect(preload).toContain('updateLaterLabel(locale)')
    expect(preload).toContain('checkForUpdatesLabel(locale)')
    expect(preload).toContain('installWhenReady = true')
    expect(preload).toContain("ipcRenderer.invoke('updates:download')")
    expect(preload).toContain("ipcRenderer.invoke('updates:install')")
    expect(preload).toContain("ipcRenderer.invoke('updates:check')")

    const channelMatches = preload.match(/ipcRenderer\.invoke\('(updates:[^']+)'/g) ?? []
    const channels = [
      ...new Set(
        [...preload.matchAll(/ipcRenderer\.invoke\('(updates:[^']+)'/g)].map((m) => m[1]!)
      )
    ]
    const allowed = [
      'updates:check',
      'updates:status',
      'updates:download',
      'updates:install',
      'updates:skip',
      'updates:install-version',
      'updates:list-versions'
    ]
    expect(channels.length).toBeGreaterThan(0)
    expect(channels.every((c) => allowed.includes(c))).toBe(true)
  })
})
