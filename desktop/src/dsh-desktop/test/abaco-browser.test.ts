import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  ABACO_BROWSER_CHROME_HEIGHT,
  ABACO_BROWSER_DEFAULT_URL,
  ABACO_BROWSER_PARTITION,
  abacoBrowserChannels,
  isHttpUrl,
  normalizeBrowserUrl
} from '../src/shared/abaco-browser'

/**
 * F0 invariants of the integrated browser. Behaviour lives in Electron views, so
 * these assertions pin the structural contract the overlay's security and the
 * plugin/plugin-profile mounting depend on: the overlay's own session partition,
 * no `secureWindow` on the browsed page, an IPC surface reachable only from the
 * Harness main frame and the chrome bar, and the launcher occupying the real
 * `sidebar.footer.action` slot.
 */
describe('ABACO browser overlay (F0)', () => {
  it('normalizes typed addresses to http(s) and refuses every other scheme', () => {
    expect(normalizeBrowserUrl('example.com')).toBe('https://example.com')
    expect(normalizeBrowserUrl('  https://example.com/a?b=1  ')).toBe('https://example.com/a?b=1')
    expect(normalizeBrowserUrl('http://127.0.0.1:57431')).toBe('http://127.0.0.1:57431')
    expect(isHttpUrl(ABACO_BROWSER_DEFAULT_URL)).toBe(true)
    expect(isHttpUrl('chrome-error://chromewebdata/')).toBe(false)
    expect(() => normalizeBrowserUrl('file:///etc/passwd')).toThrow(/http and https/u)
    expect(() => normalizeBrowserUrl('javascript:alert(1)')).toThrow(/http and https/u)
    expect(() => normalizeBrowserUrl('   ')).toThrow(/required/u)
  })

  it('keeps the browsed page in its own session with view-level hardening', async () => {
    const controller = await readFile('src/main/abaco-browser-controller.ts', 'utf8')

    expect(ABACO_BROWSER_PARTITION.startsWith('persist:')).toBe(true)
    expect(controller).toContain('partition: ABACO_BROWSER_PARTITION')
    expect(controller).toContain('sandbox: true')
    expect(controller).toContain('contextIsolation: true')
    expect(controller).toContain('nodeIntegration: false')
    // The browsed page must never be locked down by the shell's navigation
    // guard: browsing the open web is the feature, the partition is the boundary.
    expect(controller).not.toContain('secureWindow(')
    expect(controller).not.toContain("from './security'")
    expect(controller).toContain('setWindowOpenHandler')
    expect(controller).toContain("event.preventDefault()")
    expect(controller).toContain('setPermissionCheckHandler(() => false)')
    expect(controller).toContain('setPermissionRequestHandler')
    expect(controller).toContain("on('will-download'")
    expect(controller).toContain('session.fromPartition(ABACO_BROWSER_PARTITION)')
  })

  it('mounts the overlay as child views and keeps both glued to the window content rect', async () => {
    const controller = await readFile('src/main/abaco-browser-controller.ts', 'utf8')

    expect(controller).toContain('new WebContentsView')
    expect(controller).toContain('this.parent.contentView.addChildView(pageView)')
    // Insertion order is what paints the chrome strip above the page.
    expect(controller).toContain('this.parent.contentView.addChildView(chromeBarView)')
    expect(controller).toContain('removeChildView(pageView)')
    expect(controller).toContain('removeChildView(chromeBarView)')
    expect(controller).toContain("this.parent.on('resize', this.syncBounds)")
    expect(controller).toContain("this.parent.on('enter-full-screen', this.syncBounds)")
    expect(controller).toContain('this.parent.getContentBounds()')
    expect(ABACO_BROWSER_CHROME_HEIGHT).toBe(44)
  })

  it('registers the control channels behind a main-frame-or-chrome-bar guard', async () => {
    const main = await readFile('src/main/index.ts', 'utf8')

    for (const name of ['open', 'close', 'navigate', 'back', 'forward', 'reload', 'isOpen'] as const) {
      expect(abacoBrowserChannels[name]).toBe(`abaco:browser:${name}`)
      expect(main).toContain(`ipcMain.handle(abacoBrowserChannels.${name},`)
    }
    expect(main).toContain('assertTrustedAbacoBrowserEvent(event)')
    expect(main).toContain('event.sender === mainWindow.webContents')
    expect(main).toContain('event.sender === chromeBar')
    expect(main).toContain('registerAbacoBrowserHandlers()')
    expect(main).toContain('new AbacoBrowserController(window, {')
    expect(main).toContain("chromeHtmlPath: desktopResourcePath('abaco-browser-chrome.html')")
    expect(main).toContain("chromePreloadPath: join(import.meta.dirname, '../preload/abaco-browser-chrome.cjs')")
  })

  it('bridges every control to the Harness page through the preload', async () => {
    const preload = await readFile('src/preload/index.ts', 'utf8')

    expect(preload).toContain("contextBridge.exposeInMainWorld('dshAbacoBrowser'")
    for (const method of ['open', 'close', 'navigate', 'back', 'forward', 'reload', 'isOpen']) {
      expect(preload).toContain(`${method}:`)
    }
    expect(preload).toContain('ipcRenderer.invoke(abacoBrowserChannels.open')
  })

  it('ships the chrome bar as a local child view with its own preload entry', async () => {
    const controller = await readFile('src/main/abaco-browser-controller.ts', 'utf8')
    const viteConfig = await readFile('electron.vite.config.ts', 'utf8')
    const manifest = JSON.parse(await readFile('package.json', 'utf8')) as {
      build: { extraResources: { from: string; to: string }[] }
    }
    const chromePreload = await readFile('src/preload/abaco-browser-chrome.ts', 'utf8')
    const chromeHtml = await readFile('build/abaco-browser-chrome.html', 'utf8')

    expect(viteConfig).toContain("'abaco-browser-chrome': resolve('src/preload/abaco-browser-chrome.ts')")
    expect(manifest.build.extraResources).toContainEqual({
      from: 'build/abaco-browser-chrome.html',
      to: 'abaco-browser-chrome.html'
    })
    expect(controller).toContain('preload: this.paths.chromePreloadPath')
    expect(controller).toContain('chromeBarView.webContents.setZoomFactor(1)')
    expect(controller).toContain('loadFile(this.paths.chromeHtmlPath)')
    expect(chromePreload).toContain('ipcRenderer.invoke(channel, ...args)')
    expect(chromePreload).toContain('invoke(abacoBrowserChannels.back)')
    expect(chromePreload).toContain('invoke(abacoBrowserChannels.close)')
    expect(chromePreload).toContain("document.body.dataset.platform = process.platform")
    expect(chromeHtml).toContain("default-src 'none'")
    expect(chromeHtml).toContain('abaco-browser-address')
  })

  it('launches the overlay from the stock sidebar footer slot without touching ctx', async () => {
    const client = await readFile('packages/abaco-browser/client.js', 'utf8')
    const manifest = JSON.parse(await readFile('packages/abaco-browser/package.json', 'utf8')) as {
      name: string
      dsh: { client: { inject: string[]; platform: string } }
    }

    // `sidebar.footer.action` is declared by the stock sidebar package as a
    // root-scope list slot whose occupant props are `{ wide }`.
    expect(manifest.name).toBe('abaco-browser')
    expect(manifest.dsh.client.inject).toEqual(['@deepseek-ai/dsh-client-ui-sidebar'])
    expect(manifest.dsh.client.platform).toBe('web')
    expect(client).toContain("const SLOT = 'sidebar.footer.action'")
    expect(client).toContain('ctx.slots.inject(SLOT')
    expect(client).toContain('ctx.slots.register(')
    expect(client).toContain("const inject = ['slots']")
    // The launcher only reads the slot's own `wide` prop and the bridge global.
    expect(client).toContain('window.dshAbacoBrowser')
    expect(client).not.toContain('ctx.props')
    expect(client).not.toContain('ctx.get(')
  })
})
