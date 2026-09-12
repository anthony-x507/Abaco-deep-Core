import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  ABACO_BROWSER_CHROME_HEIGHT,
  ABACO_BROWSER_DEFAULT_PLACEMENT,
  ABACO_BROWSER_EMPTY_VIEW_BOUNDS,
  ABACO_BROWSER_PANEL_MAX_HEIGHT_PX,
  ABACO_BROWSER_PANEL_MAX_ASPECT,
  ABACO_BROWSER_PANEL_MAX_WIDTH_PX,
  ABACO_BROWSER_PANEL_MIN_ASPECT,
  ABACO_BROWSER_PANEL_MIN_WIDTH_PX,
  ABACO_BROWSER_PANEL_WIDTH_PX,
  abacoBrowserRectsOverlap,
  buildSkillHandoffMarkdown,
  canReportAbacoBrowserHostBounds,
  clampAbacoBrowserPanelWidth,
  clampPanelViewport,
  computeAbacoBrowserSyncBounds,
  ABACO_BROWSER_CTRL_HOST,
  ABACO_BROWSER_CTRL_PORT_ENV,
  ABACO_BROWSER_CTRL_TOKEN_ENV,
  ABACO_BROWSER_DEFAULT_MODE,
  ABACO_BROWSER_DEFAULT_URL,
  ABACO_BROWSER_PARTITION,
  ABACO_BROWSER_TAKEOVER_MESSAGE,
  abacoBrowserChannels,
  abacoBrowserRpcRoutes,
  isAbacoBrowserMode,
  isHttpUrl,
  normalizeBrowserUrl,
  type AbacoBrowserState
} from '../src/shared/abaco-browser'
import {
  AbacoBrowserRpcServer,
  type AbacoBrowserControlTarget
} from '../src/main/abaco-browser-rpc'
import {
  clickInPage,
  readDomInPage,
  typeInPage,
  waitForInPage
} from '../src/main/abaco-browser-page-scripts'

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

  it('mounts the browser as child views and syncs bounds from placement geometry', async () => {
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
    expect(controller).toContain('computeAbacoBrowserSyncBounds')
    expect(controller).toContain('setPlacement')
    expect(controller).toContain('reportPanelHostBounds')
    expect(controller).toContain('ABACO_BROWSER_DEFAULT_PLACEMENT')
    expect(ABACO_BROWSER_CHROME_HEIGHT).toBe(44)
    expect(ABACO_BROWSER_DEFAULT_PLACEMENT).toBe('panel')
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
    expect(manifest.dsh.client.inject).toEqual(['@deepseek-ai/dsh-client-ui-sidebar', '@deepseek-ai/dsh-client-ui-layout'])
    expect(manifest.dsh.client.platform).toBe('web')
    expect(client).toContain("const SLOT = 'sidebar.footer.action'")
    expect(client).toContain('ctx.slots.inject(SLOT')
    expect(client).toContain('ctx.slots.register(')
    expect(client).toContain("const inject = ['slots', 'layout']")
    expect(client).toContain("const NOTIFY_SLOT = 'conversation.input.left'")
    expect(client).toContain('layout.openDetails')
    expect(client).toContain('reportPanelHostBounds')
    expect(client).toContain('onScreenRecordingStopped')
    expect(client).toContain('inputActions.submit')
    // The launcher only reads the slot's own `wide` prop and the bridge global.
    expect(client).toContain('window.dshAbacoBrowser')
    expect(client).not.toContain('ctx.props')
    expect(client).not.toContain('ctx.get(')
  })
})

/* ──────────────────────────────────────────────────────────────────────────────
 * F1 — the loopback control plane
 * ────────────────────────────────────────────────────────────────────────────── */

/** The page state a stub reports; every field is spelled out so a shape change fails loudly. */
function stubState(overrides: Partial<AbacoBrowserState> = {}): AbacoBrowserState {
  return {
    open: true,
    mode: 'agent',
    url: 'https://example.com/',
    title: 'Example',
    loading: false,
    canGoBack: false,
    canGoForward: false,
    screenRecording: false,
    lastScreenRecordingPath: '',
    ...overrides
  }
}

/**
 * A recording stand-in for `AbacoBrowserController`.
 *
 * The server is deliberately decoupled from Electron (see the module docstring),
 * which is what lets these tests start the *real* listener and talk to it over a
 * real socket: the only fake in the picture is the thing on the far side of the
 * RPC, which is exactly the seam under test.
 */
function stubTarget(options: { open?: boolean; mode?: 'agent' | 'manual' } = {}): {
  target: AbacoBrowserControlTarget
  calls: string[]
} {
  const calls: string[] = []
  const open = options.open !== false
  let mode: 'agent' | 'manual' = options.mode ?? 'agent'
  const target: AbacoBrowserControlTarget = {
    isOpen: () => open,
    browserMode: () => mode,
    agentState: () => stubState({ open, mode }),
    agentNavigate: async (url) => {
      calls.push(`navigate:${url}`)
      return stubState({ open: true, mode, url })
    },
    agentClick: async (selector) => {
      calls.push(`click:${selector}`)
      return { element: { selector, tag: 'button', text: 'Go' } }
    },
    agentType: async (selector, text, actionOptions) => {
      calls.push(`type:${selector}:${text}:${actionOptions?.submit === true ? 'submit' : 'plain'}`)
      return {
        element: { selector, tag: 'input', text: '' },
        wrote: true,
        submitted: actionOptions?.submit === true
      }
    },
    agentReadDom: async (domOptions) => {
      calls.push(`read-dom:${domOptions?.maxChars ?? 'default'}`)
      return {
        url: 'https://example.com/',
        title: 'Example',
        text: 'hello',
        charCount: 5,
        truncated: false,
        headings: [{ level: 1, text: 'Hello' }],
        links: [{ text: 'More', href: 'https://example.com/more' }]
      }
    },
    agentWaitFor: async (selector) => {
      calls.push(`wait-for:${selector}`)
      return { element: { selector, tag: 'div', text: 'ready' }, waitedMs: 12 }
    },
    agentScreenshot: async () => {
      calls.push('screenshot')
      return { mimeType: 'image/png', width: 10, height: 20, byteLength: 3, dataBase64: 'AAA=' }
    },
    agentGrabControl: () => {
      mode = 'agent'
      calls.push('grab-control')
      return stubState({ open, mode })
    },
    agentReleaseControl: () => {
      mode = 'manual'
      calls.push('release-control')
      return stubState({ open, mode })
    },
    agentScreenRecordStart: async () => {
      calls.push('screen-record-start')
      return {
        recording: true,
        sessionId: 'sess',
        startedAt: '2026-01-01T00:00:00.000Z',
        lastRecordingPath: '',
        lastError: ''
      }
    },
    agentScreenRecordStop: async () => {
      calls.push('screen-record-stop')
      return {
        ok: true,
        path: '/tmp/rec.webm',
        sessionId: 'sess',
        durationMs: 1000,
        mimeType: 'video/webm' as const,
        byteLength: 12,
        notice: 'Screen recording saved: /tmp/rec.webm',
        frameCount: 3
      }
    }
  }
  return { target, calls }
}

/** One authenticated request against a running server. */
async function rpc(
  server: AbacoBrowserRpcServer,
  route: string,
  body?: unknown,
  init: { method?: string; token?: string | null } = {}
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const handle = server.handle()
  if (!handle) throw new Error('the control server is not running')
  const token = init.token === undefined ? handle.token : init.token
  const response = await fetch(`http://${ABACO_BROWSER_CTRL_HOST}:${handle.port}/${route}`, {
    method: init.method ?? 'POST',
    headers: {
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      'content-type': 'application/json'
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })
  return { status: response.status, payload: (await response.json()) as Record<string, unknown> }
}

describe('ABACO browser agent control plane (F1)', () => {
  it('mints a per-launch token and exposes port plus token to the harness child', async () => {
    const { target } = stubTarget()
    const server = new AbacoBrowserRpcServer({ controller: () => target, log: () => {} })

    // Nothing is handed over before the listener exists: an unstarted server
    // must degrade into the tools' clear "not available" error, never into a
    // connection attempt against a port that was never bound.
    expect(server.environment()).toEqual({})
    expect(server.handle()).toBeUndefined()

    const handle = await server.start()
    expect(handle.port).toBeGreaterThan(0)
    expect(handle.token.length).toBeGreaterThan(20)
    expect(server.environment()).toEqual({
      [ABACO_BROWSER_CTRL_PORT_ENV]: String(handle.port),
      [ABACO_BROWSER_CTRL_TOKEN_ENV]: handle.token
    })
    // Ephemeral: the OS assigns it, so two launches cannot collide.
    expect(handle.port).not.toBe(0)

    await server.stop()
    expect(server.environment()).toEqual({})
    await expect(
      fetch(`http://${ABACO_BROWSER_CTRL_HOST}:${handle.port}/state`)
    ).rejects.toThrow()
  })

  it('rejects a missing, malformed or wrong token before the controller is reached', async () => {
    const { target, calls } = stubTarget()
    const server = new AbacoBrowserRpcServer({ controller: () => target, log: () => {} })
    const handle = await server.start()

    const cases: (string | null)[] = [
      null,
      '',
      'not-the-token',
      // Same length as a real token, wrong content: this is the case
      // `timingSafeEqual` exists for, and it must still be refused.
      'x'.repeat(handle.token.length)
    ]
    for (const token of cases) {
      const { status, payload } = await rpc(server, 'click', { selector: '#go' }, { token })
      expect(status).toBe(401)
      expect(payload.ok).toBe(false)
    }
    expect(calls).toEqual([])
    await server.stop()
  })

  it('answers every documented route and nothing else', async () => {
    const { target, calls } = stubTarget()
    const server = new AbacoBrowserRpcServer({ controller: () => target, log: () => {} })
    await server.start()

    // One route per agent tool, and each one reaches the matching controller method.
    const results: Record<string, number> = {}
    for (const route of abacoBrowserRpcRoutes) {
      const body: Record<string, unknown> =
        route === 'navigate'
          ? { url: 'https://example.com/' }
          : route === 'click' || route === 'wait-for'
            ? { selector: '#go' }
            : route === 'type'
              ? { selector: '#q', text: 'hello', submit: true }
              : {}
      const { status, payload } = await rpc(server, route, body)
      results[route] = status
      expect(payload.ok).toBe(true)
      expect(payload.result).toBeDefined()
    }
    expect(results).toEqual(Object.fromEntries(abacoBrowserRpcRoutes.map((route) => [route, 200])))

    // Dispatch actually landed on the controller, argument and all. The order
    // follows `abacoBrowserRpcRoutes`, i.e. one route per tool.
    expect(calls).toEqual([
      'navigate:https://example.com/',
      'click:#go',
      'type:#q:hello:submit',
      'read-dom:default',
      'wait-for:#go',
      'screenshot',
      'grab-control',
      'release-control',
      'screen-record-start',
      'screen-record-stop'
    ])

    const unknown = await rpc(server, 'reboot', {})
    expect(unknown.status).toBe(404)
    expect(String(unknown.payload.error)).toContain('Unknown browser control route')
    await server.stop()
  })

  it('accepts GET only for the read-only state route', async () => {
    const { target } = stubTarget()
    const server = new AbacoBrowserRpcServer({ controller: () => target, log: () => {} })
    await server.start()

    const state = await rpc(server, 'state', undefined, { method: 'GET' })
    expect(state.status).toBe(200)
    expect(state.payload.result).toEqual(stubState())

    // A stray GET must never be able to click a button.
    for (const route of ['click', 'navigate', 'screenshot']) {
      const { status } = await rpc(server, route, undefined, { method: 'GET' })
      expect(status).toBe(405)
    }
    const deleted = await rpc(server, 'state', undefined, { method: 'DELETE' })
    expect(deleted.status).toBe(405)
    await server.stop()
  })

  it('refuses agent actions in manual mode with the canonical takeover message', async () => {
    const { target, calls } = stubTarget({ mode: 'manual' })
    const server = new AbacoBrowserRpcServer({ controller: () => target, log: () => {} })
    await server.start()

    const gated = abacoBrowserRpcRoutes.filter(
      (name) =>
        name !== 'state' &&
        name !== 'grab-control' &&
        name !== 'release-control' &&
        name !== 'screen-record-start' &&
        name !== 'screen-record-stop'
    )
    for (const route of gated) {
      const { status, payload } = await rpc(server, route, { url: 'https://example.com/', selector: '#go', text: 'x' })
      expect(status).toBe(409)
      expect(payload.error).toBe(ABACO_BROWSER_TAKEOVER_MESSAGE)
    }
    // Reading the state is what makes the refusal explainable, so it stays open.
    const state = await rpc(server, 'state')
    expect(state.status).toBe(200)
    expect((state.payload.result as AbacoBrowserState).mode).toBe('manual')
    // Grab is how the agent leaves manual mode — same setBrowserMode as the chrome bar.
    const grabbed = await rpc(server, 'grab-control', {})
    expect(grabbed.status).toBe(200)
    expect((grabbed.payload.result as AbacoBrowserState).mode).toBe('agent')
    expect(calls).toEqual(['grab-control'])
    await server.stop()
  })

  it('refuses actions on a closed overlay but still lets navigate mount it', async () => {
    const { target, calls } = stubTarget({ open: false })
    const server = new AbacoBrowserRpcServer({ controller: () => target, log: () => {} })
    await server.start()

    const closed = await rpc(server, 'read-dom')
    expect(closed.status).toBe(503)
    expect(String(closed.payload.error)).toContain('not open')

    // `navigate` is the one route allowed to mount the overlay itself.
    const opened = await rpc(server, 'navigate', { url: 'https://example.com/' })
    expect(opened.status).toBe(200)
    expect(calls).toEqual(['navigate:https://example.com/'])
    await server.stop()
  })

  it('rejects malformed bodies and an oversized one without dispatching', async () => {
    const { target, calls } = stubTarget()
    const server = new AbacoBrowserRpcServer({ controller: () => target, log: () => {} })
    const handle = await server.start()

    const missing = await rpc(server, 'click', {})
    expect(missing.status).toBe(400)
    expect(String(missing.payload.error)).toContain('"selector"')

    const wrongType = await rpc(server, 'navigate', { url: 42 })
    expect(wrongType.status).toBe(400)

    const badJson = await fetch(`http://${ABACO_BROWSER_CTRL_HOST}:${handle.port}/click`, {
      method: 'POST',
      headers: { authorization: `Bearer ${handle.token}`, 'content-type': 'application/json' },
      body: '{not json'
    })
    expect(badJson.status).toBe(400)

    const huge = await fetch(`http://${ABACO_BROWSER_CTRL_HOST}:${handle.port}/click`, {
      method: 'POST',
      headers: { authorization: `Bearer ${handle.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ selector: 'x'.repeat(200_000) })
    })
    expect(huge.status).toBe(413)

    expect(calls).toEqual([])
    await server.stop()
  })

  it('reports an unavailable window instead of throwing', async () => {
    const server = new AbacoBrowserRpcServer({ controller: () => undefined, log: () => {} })
    await server.start()
    const { status, payload } = await rpc(server, 'state')
    expect(status).toBe(503)
    expect(payload.ok).toBe(false)
    await server.stop()
  })
})

/* ──────────────────────────────────────────────────────────────────────────────
 * F1 — agent tools, controller gate and page scripts
 * ────────────────────────────────────────────────────────────────────────────── */

describe('ABACO browser agent tools (F1)', () => {
  it('binds the control server to loopback with an OS-assigned port', async () => {
    const rpc = await readFile('src/main/abaco-browser-rpc.ts', 'utf8')
    expect(ABACO_BROWSER_CTRL_HOST).toBe('127.0.0.1')
    expect(rpc).toContain('server.listen(0, ABACO_BROWSER_CTRL_HOST')
    // Never a wildcard bind, and never the name `localhost`, which can resolve
    // to one. The quoted forms are what a `listen()` argument would look like;
    // the docstring above spells them out in prose.
    expect(rpc).not.toContain("'0.0.0.0'")
    expect(rpc).not.toContain('"0.0.0.0"')
    expect(rpc).not.toContain("'localhost'")
    expect(rpc).toContain('timingSafeEqual')
    expect(rpc).toContain("header.startsWith('Bearer ')")
    expect(rpc).toContain('isLoopback(request.socket.remoteAddress)')
  })

  it('keeps port and token on a spawn-time environment seam the shell owns', async () => {
    const runtime = await readFile('src/main/runtime/harness-runtime.ts', 'utf8')
    const main = await readFile('src/main/index.ts', 'utf8')

    // The values are read at every spawn, so a safe-mode or plugin-reset
    // relaunch cannot inherit a port from an earlier launch.
    expect(runtime).toContain('extraEnvironment?(): NodeJS.ProcessEnv')
    expect(runtime).toContain('this.options.extraEnvironment?.() ?? {}')
    expect(runtime).toContain('extraEnvironment: NodeJS.ProcessEnv = {}')
    expect(runtime).toContain('...extraEnvironment,')
    expect(main).toContain('extraEnvironment: () => abacoBrowserRpc?.environment() ?? {}')
    expect(main).toContain('abacoBrowserRpc = new AbacoBrowserRpcServer({')
    expect(main).toContain('controller: () => abacoBrowserController')
    expect(main).toContain('abacoBrowserRpc?.stop()')
  })

  it('gates every mutating agent action behind the takeover flag', async () => {
    const controller = await readFile('src/main/abaco-browser-controller.ts', 'utf8')

    expect(controller).toContain('private mode: AbacoBrowserMode = ABACO_BROWSER_DEFAULT_MODE')
    expect(controller).toContain('if (this.mode !== \'agent\') throw new Error(ABACO_BROWSER_TAKEOVER_MESSAGE)')
    expect(controller).toContain('browserMode(): AbacoBrowserMode')
    expect(controller).toContain('setBrowserMode(mode: AbacoBrowserMode)')
    // Every agent action but the read-only state passes the gate.
    for (const action of [
      'async agentNavigate(',
      'async agentClick(',
      'async agentType(',
      'async agentReadDom(',
      'async agentWaitFor(',
      'async agentScreenshot('
    ]) {
      expect(controller).toContain(action)
    }
    expect(controller).toContain('agentState(): AbacoBrowserState')
    expect((controller.match(/this\.requireAgentControl\(\)/gu) ?? []).length).toBe(6)
    // Page code runs through `executeJavaScript`, never through the shell.
    expect(controller).toContain('contents.executeJavaScript(source, true)')
    expect(ABACO_BROWSER_DEFAULT_MODE).toBe('agent')
    expect(isAbacoBrowserMode('manual')).toBe(true)
    expect(isAbacoBrowserMode('auto')).toBe(false)
  })

  it('exposes the mode switch to the chrome bar and to agent grab/release tools', async () => {
    const main = await readFile('src/main/index.ts', 'utf8')
    const preload = await readFile('src/preload/index.ts', 'utf8')
    const chromePreload = await readFile('src/preload/abaco-browser-chrome.ts', 'utf8')
    const chromeHtml = await readFile('build/abaco-browser-chrome.html', 'utf8')
    const shared = await readFile('src/shared/abaco-browser.ts', 'utf8')
    const controller = await readFile('src/main/abaco-browser-controller.ts', 'utf8')

    expect(abacoBrowserChannels.mode).toBe('abaco:browser:mode')
    expect(abacoBrowserChannels.setMode).toBe('abaco:browser:set-mode')
    expect(main).toContain('ipcMain.handle(abacoBrowserChannels.mode,')
    expect(main).toContain('ipcMain.handle(abacoBrowserChannels.setMode,')
    expect(main).toContain('if (!isAbacoBrowserMode(mode))')
    expect(preload).toContain('mode: (): Promise<AbacoBrowserMode> => ipcRenderer.invoke(abacoBrowserChannels.mode)')
    // Harness page script still cannot flip mode over IPC; the agent uses the
    // loopback grab-control / release-control routes (same setBrowserMode).
    expect(preload).not.toContain('abacoBrowserChannels.setMode')
    expect(chromePreload).toContain('invoke(abacoBrowserChannels.setMode, mode)')
    expect(chromePreload).toContain('modeButton.dataset.mode = next')
    expect(chromeHtml).toContain('id="abaco-browser-mode"')
    expect(chromeHtml).toContain('abaco-browser-mode')
    expect(abacoBrowserRpcRoutes).toContain('grab-control')
    expect(abacoBrowserRpcRoutes).toContain('release-control')
    expect(shared).toContain("'grab-control'")
    expect(controller).toContain('agentGrabControl(): AbacoBrowserState')
    expect(controller).toContain('agentReleaseControl(): AbacoBrowserState')
    expect(controller).toContain("this.setBrowserMode('agent')")
    expect(controller).toContain("this.setBrowserMode('manual')")
    expect(controller).toContain('if (!this.isOpen()) this.open()')
  })

  it('registers the agent tools (incl. grab/release) against the real defineTool schema compiler', async () => {
    const plugin = await import('../packages/abaco-browser/index.js')
    interface CompiledSchema {
      properties: Record<string, unknown>
      required?: string[]
    }
    const registered: { name: string; parameters: CompiledSchema; output: CompiledSchema }[] = []
    const ctx = {
      tools: {
        register(definition: {
          name: string
          parameters: CompiledSchema
          output: { schema: CompiledSchema }
        }) {
          // Reading the definition here is what makes this test bite: `defineTool`
          // compiled — and therefore validated — every parameter and output
          // schema against the harness's own DSL before it reached this registry,
          // so a malformed spec would already have thrown.
          registered.push({
            name: definition.name,
            parameters: definition.parameters,
            output: definition.output.schema
          })
          return () => {}
        }
      }
    }

    plugin.apply(ctx)

    expect(plugin.name).toBe('abaco-browser')
    expect(plugin.inject).toEqual(['tools'])
    expect(registered.map((tool) => tool.name)).toEqual([
      'abaco_browser_navigate',
      'abaco_browser_click',
      'abaco_browser_type',
      'abaco_browser_read_dom',
      'abaco_browser_wait_for',
      'abaco_browser_state',
      'abaco_browser_screenshot',
      'abaco_browser_grab_control',
      'abaco_browser_release_control',
      'abaco_browser_screen_record_start',
      'abaco_browser_screen_record_stop'
    ])
    // The compiled JSON Schema the model actually receives: a silently renamed
    // or dropped parameter would make a tool uncallable.
    const shape = Object.fromEntries(
      registered.map((tool) => [
        tool.name,
        {
          properties: Object.keys(tool.parameters.properties).sort(),
          required: [...(tool.parameters.required ?? [])].sort()
        }
      ])
    )
    expect(shape).toEqual({
      abaco_browser_navigate: { properties: ['timeoutMs', 'url'], required: ['url'] },
      abaco_browser_click: { properties: ['selector', 'timeoutMs'], required: ['selector'] },
      abaco_browser_type: {
        properties: ['selector', 'submit', 'text', 'timeoutMs'],
        required: ['selector', 'text']
      },
      abaco_browser_read_dom: { properties: ['maxChars'], required: [] },
      abaco_browser_wait_for: { properties: ['selector', 'timeoutMs'], required: ['selector'] },
      abaco_browser_state: { properties: [], required: [] },
      abaco_browser_screenshot: { properties: [], required: [] },
      abaco_browser_grab_control: { properties: [], required: [] },
      abaco_browser_release_control: { properties: [], required: [] },
      abaco_browser_screen_record_start: { properties: [], required: [] },
      abaco_browser_screen_record_stop: { properties: [], required: [] }
    })
    // Every action tool reports ownership, so a refusal and a success describe
    // the same page the same way.
    for (const tool of registered) {
      if (
        tool.name === 'abaco_browser_screenshot' ||
        tool.name === 'abaco_browser_read_dom' ||
        tool.name === 'abaco_browser_screen_record_start' ||
        tool.name === 'abaco_browser_screen_record_stop'
      ) {
        continue
      }
      expect(Object.keys(tool.output.properties)).toContain('mode')
    }
  })

  it('reads the same control-plane environment names as the shared contract', async () => {
    const plugin = await readFile('packages/abaco-browser/index.js', 'utf8')
    const manifest = JSON.parse(await readFile('packages/abaco-browser/package.json', 'utf8')) as {
      peerDependencies: Record<string, string>
    }

    // The plugin cannot import `src/shared/abaco-browser.ts` (separate package,
    // resolved inside the Harness profile), so the two copies are asserted
    // equal here rather than trusted to stay in step.
    expect(plugin).toContain(`const PORT_ENV = '${ABACO_BROWSER_CTRL_PORT_ENV}'`)
    expect(plugin).toContain(`const TOKEN_ENV = '${ABACO_BROWSER_CTRL_TOKEN_ENV}'`)
    expect(plugin).toContain(`const CONTROL_HOST = '${ABACO_BROWSER_CTRL_HOST}'`)
    // Every route the plugin posts to must exist on the server. The calls are
    // multi-line, so the quotes are matched rather than assumed.
    for (const route of abacoBrowserRpcRoutes) {
      if (route === 'state') continue
      expect(plugin).toMatch(new RegExp(`callRoute\\(\\s*['"]${route}['"]`, 'u'))
    }
    expect(plugin).toMatch(/callRoute\(\s*['"]state['"]/u)
    // Unconfigured, unreachable and takeover failures are all explainable.
    expect(plugin).toContain('is not available in this session')
    expect(plugin).toContain('is unreachable at')
    // The host half needs the tools service and nothing else. Comments talk
    // about `ctx` at length, so the assertion runs on code with them stripped:
    // outside a comment, the only reachable member is `ctx.tools.register`.
    expect(plugin).toContain("const inject = ['tools']")
    const code = plugin.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '')
    expect(code).toContain('ctx.tools.register(')
    expect(code.replace(/ctx\.tools\.register/gu, '')).not.toContain('ctx.')
    expect(manifest.peerDependencies['@deepseek-ai/dsh-tools']).toBeDefined()
    // Screenshots are handed over as a path, never as context-filling base64.
    expect(plugin).toContain('persistScreenshot')
    expect(plugin).toContain("join(root, 'abaco-browser', 'screenshots')")
  })

  it('ships page scripts that serialize into self-contained page code', () => {
    // `executeJavaScript` receives `String(fn)`, so a body that referenced an
    // enclosing binding would be a ReferenceError in the page. Serializing and
    // re-parsing each body here catches a body that is not a valid expression;
    // the free-variable rule is enforced by construction (arguments only).
    for (const body of [clickInPage, typeInPage, readDomInPage, waitForInPage]) {
      const source = `(${body.toString()})`
      const revived = new Function(`return ${source}`)()
      expect(typeof revived).toBe('function')
      expect(source).toContain('document.querySelector')
    }
    // Nothing in a page body may reach for a module-level helper.
    const click = clickInPage.toString()
    const type = typeInPage.toString()
    expect(click).not.toContain('ABACO_')
    expect(type).toContain('HTMLTextAreaElement.prototype')
    expect(type).toMatch(/new KeyboardEvent\(\s*['"]keydown['"]/u)
    expect(type).toContain('requestSubmit')
    expect(readDomInPage.toString()).toContain('innerText')
    expect(waitForInPage.toString()).toContain('setTimeout')
  })
})


describe('ABACO browser P1 screen recording + panel', () => {
  it('computes panel/overlay syncBounds geometry with clamped widths', () => {
    expect(clampAbacoBrowserPanelWidth(10)).toBe(ABACO_BROWSER_PANEL_MIN_WIDTH_PX)
    expect(clampAbacoBrowserPanelWidth(9999)).toBe(ABACO_BROWSER_PANEL_MAX_WIDTH_PX)
    expect(clampAbacoBrowserPanelWidth(ABACO_BROWSER_PANEL_WIDTH_PX)).toBe(ABACO_BROWSER_PANEL_WIDTH_PX)
    expect(ABACO_BROWSER_PANEL_MIN_WIDTH_PX).toBe(360)

    // Panel without reserved host → empty / no-mount (pin-derecha REVOKED).
    const panel = computeAbacoBrowserSyncBounds({
      contentWidth: 1400,
      contentHeight: 900,
      placement: 'panel'
    })
    expect(panel.page).toEqual(ABACO_BROWSER_EMPTY_VIEW_BOUNDS)
    expect(panel.chrome.width).toBe(0)
    expect(panel.chrome.height).toBe(0)

    const overlay = computeAbacoBrowserSyncBounds({
      contentWidth: 1400,
      contentHeight: 900,
      placement: 'overlay'
    })
    expect(overlay.page).toEqual({ x: 0, y: 0, width: 1400, height: 900 })
    expect(overlay.chrome.width).toBe(1400)

    // Hosted: full column height (max-720 + aspect REVOKED).
    const hosted = computeAbacoBrowserSyncBounds({
      contentWidth: 1400,
      contentHeight: 900,
      placement: 'panel',
      hostBounds: { x: 1000, y: 10, width: 380, height: 800 }
    })
    expect(hosted.page.width).toBe(380)
    expect(hosted.page.x).toBe(1000)
    expect(hosted.page.y).toBe(10)
    expect(hosted.page.height).toBe(800)
    expect(hosted.page.height).toBeGreaterThan(ABACO_BROWSER_PANEL_MAX_HEIGHT_PX)
  })

  it('ships a desktopCapturer MediaRecorder screen recorder and wires RPC + IPC', async () => {
    const recorder = await readFile('src/main/abaco-browser-screen-recorder.ts', 'utf8')
    const controller = await readFile('src/main/abaco-browser-controller.ts', 'utf8')
    const rpc = await readFile('src/main/abaco-browser-rpc.ts', 'utf8')
    const shared = await readFile('src/shared/abaco-browser.ts', 'utf8')
    const main = await readFile('src/main/index.ts', 'utf8')
    const preload = await readFile('src/preload/index.ts', 'utf8')

    expect(recorder).toContain('desktopCapturer')
    expect(recorder).toContain('getSources')
    expect(recorder).toContain('MediaRecorder')
    expect(recorder).toContain('.webm')
    expect(controller).toContain('AbacoBrowserScreenRecorder')
    expect(controller).toContain('agentScreenRecordStart')
    expect(controller).toContain('agentScreenRecordStop')
    expect(rpc).toContain("'screen-record-start'")
    expect(rpc).toContain("'screen-record-stop'")
    expect(rpc).toContain('SCREEN_RECORD_ROUTES')
    expect(shared).toContain("'screen-record-start'")
    expect(shared).toContain('ABACO_BROWSER_SCREEN_RECORDINGS_DIRNAME')
    expect(shared).toContain('screenRecordStart')
    expect(shared).toContain('reportPanelHostBounds')
    expect(main).toContain('screenRecordingsDir:')
    expect(main).toContain('abacoBrowserChannels.setPlacement')
    expect(main).toContain('abacoBrowserChannels.screenRecordStart')
    expect(preload).toContain('setPlacement:')
    expect(preload).toContain('startScreenRecording:')
    expect(preload).toContain('onOpened:')
    expect(preload).toContain('onClosed:')
    expect(preload).toContain('onScreenRecordingStopped:')
    expect(controller).toContain('ABACO_BROWSER_OPENED_CHANNEL')
    expect(controller).toContain('ABACO_BROWSER_CLOSED_CHANNEL')
    expect(controller).toContain('ABACO_BROWSER_SCREEN_RECORDING_STOPPED_CHANNEL')
    expect(abacoBrowserRpcRoutes).toContain('screen-record-start')
    expect(abacoBrowserRpcRoutes).toContain('screen-record-stop')

    const client = await readFile('packages/abaco-browser/client.js', 'utf8')
    const chromeHtml = await readFile('build/abaco-browser-chrome.html', 'utf8')
    const chromePreload = await readFile('src/preload/abaco-browser-chrome.ts', 'utf8')
    const viteConfig = await readFile('electron.vite.config.ts', 'utf8')
    expect(client).toContain('reportPanelHostBounds')
    expect(client).toContain('measureDetailsColumn')
    expect(chromeHtml).toContain('id="abaco-browser-screen-record"')
    expect(chromeHtml).toContain("data-placement='panel'")
    expect(chromePreload).toContain('screenRecordStart')
    expect(viteConfig).toContain('isolatedEntries: true')
    expect(viteConfig).toContain('externalizeDeps: false')
  })
})


describe('ABACO browser P1 DoD (panel UX)', () => {
  it('U1: chrome HTML keeps F2 record visible under placement=panel', async () => {
    const chromeHtml = await readFile('build/abaco-browser-chrome.html', 'utf8')
    expect(chromeHtml).toContain("data-placement='panel'")
    expect(chromeHtml).toContain('id="abaco-browser-record"')
    expect(chromeHtml).toContain('aria-label="Grabar acciones del navegador"')
    // Must not hide .recordButton in panel; screen-record may be hidden first.
    expect(chromeHtml).toMatch(
      /body\[data-placement=['"]panel['"]\][^}]*\.screenRecordButton\s*\{[^}]*display:\s*none/u
    )
    expect(chromeHtml).toMatch(
      /body\[data-placement=['"]panel['"]\][^}]*\.recordButton\s*\{[^}]*display:\s*grid/u
    )
    expect(chromeHtml).not.toMatch(
      /body\[data-placement=['"]panel['"]\]\s*\.recordButton\s*\{[^}]*display:\s*none/u
    )
    const chromePreload = await readFile('src/preload/abaco-browser-chrome.ts', 'utf8')
    expect(chromePreload).toContain("'Grabar'")
    expect(chromePreload).toContain("'Parar grabación'")
    expect(chromePreload).toContain("dataset.pending === 'true'")
  })

  it('U2: clampPanelViewport / computeAbacoBrowserSyncBounds full-column (no card)', () => {
    const clamped = clampPanelViewport({
      width: 420,
      height: 2000,
      contentHeight: 900,
      chromeHeight: ABACO_BROWSER_CHROME_HEIGHT
    })
    expect(clamped.width).toBeGreaterThanOrEqual(ABACO_BROWSER_PANEL_MIN_WIDTH_PX)
    expect(clamped.width).toBeLessThanOrEqual(ABACO_BROWSER_PANEL_MAX_WIDTH_PX)
    // Full available height — 720/aspect card clamps REVOKED.
    expect(clamped.height).toBe(900)

    const panelNoHost = computeAbacoBrowserSyncBounds({
      contentWidth: 1280,
      contentHeight: 1000,
      placement: 'panel'
    })
    expect(panelNoHost.page).toEqual(ABACO_BROWSER_EMPTY_VIEW_BOUNDS)

    const hosted = computeAbacoBrowserSyncBounds({
      contentWidth: 1280,
      contentHeight: 1000,
      placement: 'panel',
      hostBounds: { x: 860, y: 0, width: 420, height: 1000 }
    })
    expect(hosted.page.width).toBeGreaterThanOrEqual(360)
    expect(hosted.page.width).toBeLessThanOrEqual(520)
    expect(hosted.page.height).toBe(1000)
    expect(hosted.page.height).toBeGreaterThan(720)
    expect(hosted.chrome.height).toBeLessThanOrEqual(ABACO_BROWSER_CHROME_HEIGHT)
    expect(hosted.chrome.y).toBe(hosted.page.y)
  })

  it('U3: client toggle labels Abrir/Cerrar navegador', async () => {
    const client = await readFile('packages/abaco-browser/client.js', 'utf8')
    expect(client).toContain("open: 'Abrir navegador'")
    expect(client).toContain("close: 'Cerrar navegador'")
    expect(client).toContain("open: 'Open browser'")
    expect(client).toContain("close: 'Close browser'")
    expect(client).toContain('bridge.close()')
    expect(client).toContain('bridge.open()')
    expect(client).toContain('openDetailsColumn')
  })

  it('U4: handoff builder includes action descriptions; notifier always submits', async () => {
    const markdown = buildSkillHandoffMarkdown({
      title: 'facturas-demo',
      actionDescriptions: [
        'navegar a https://panel.example.com',
        'hacer click en #login'
      ],
      skillPath: '/tmp/skills/facturas-demo/SKILL.md',
      recordingPath: '/tmp/rec/1.json'
    })
    expect(markdown).toContain('# facturas-demo')
    expect(markdown).toContain('1. navegar a https://panel.example.com')
    expect(markdown).toContain('2. hacer click en #login')
    expect(markdown).toContain('/tmp/skills/facturas-demo/SKILL.md')
    expect(markdown.toLowerCase()).toMatch(/aprend|guardar|learn|save/u)

    const client = await readFile('packages/abaco-browser/client.js', 'utf8')
    expect(client).toContain('skillMarkdown')
    expect(client).toContain('inputActions.setDraft')
    expect(client).toContain('inputActions.submit')
    const controller = await readFile('src/main/abaco-browser-controller.ts', 'utf8')
    expect(controller).toContain('handoffF2SkillToAgent')
    expect(controller).toContain('writeBrowserSkillFromRecording')
    expect(controller).toContain('buildSkillHandoffMarkdown')
    expect(controller).toContain("kind: 'f2-actions'")
    expect(controller).toContain('ABACO_BROWSER_SCREEN_RECORDING_STOPPED_CHANNEL')
  })

  it('U5: voice/broker authorize path unchanged; no spawn in voice', async () => {
    const voice = await readFile('packages/abaco-voice/index.js', 'utf8')
    expect(voice).toContain('authorize(')
    expect(voice).not.toMatch(/\bspawn\s*\(/u)
    const broker = await readFile('packages/abaco-effect-broker/index.js', 'utf8')
    expect(broker).toContain('export function authorize')
    // Controllers must not route record through authorize.
    const controller = await readFile('src/main/abaco-browser-controller.ts', 'utf8')
    expect(controller).not.toContain('authorize(')
  })

  it('U6: no window.__abaco_ctx =; patch disabled note; F1 file: deps intact', async () => {
    const client = await readFile('packages/abaco-browser/client.js', 'utf8')
    expect(client).not.toMatch(/window\.__abaco_ctx\s*=/)
    expect(client).toContain('window.__abacoBrowserLayout')
    const patch = await readFile('build/dsh-desktop.patch.yml', 'utf8')
    expect(patch.toLowerCase()).toMatch(/disabled/u)
    const pkg = await readFile('package.json', 'utf8')
    expect(pkg).toContain('"abaco-effect-broker": "file:packages/abaco-effect-broker"')
    expect(pkg).toContain('"abaco-mediacion-pilot": "file:packages/abaco-mediacion-pilot"')
    expect(pkg).toContain('"abaco-voice": "file:packages/abaco-voice"')
  })
})


describe('ABACO browser P1 hard-dock contract (H1–H7)', () => {
  it('H1: anti-overlap helper — composer ∩ monitor blocks host report', () => {
    const monitor = { x: 1000, y: 0, width: 400, height: 900 }
    const composerClear = { x: 280, y: 800, width: 600, height: 80 }
    const composerOverlap = { x: 900, y: 800, width: 400, height: 80 }
    expect(abacoBrowserRectsOverlap(monitor, composerClear)).toBe(false)
    expect(abacoBrowserRectsOverlap(monitor, composerOverlap)).toBe(true)
    expect(canReportAbacoBrowserHostBounds(monitor, composerClear)).toBe(true)
    expect(canReportAbacoBrowserHostBounds(monitor, composerOverlap)).toBe(false)
    expect(canReportAbacoBrowserHostBounds({ x: 0, y: 0, width: 4, height: 900 }, null)).toBe(false)
  })

  it('H2: panel without host is empty / no pin-derecha', () => {
    const panel = computeAbacoBrowserSyncBounds({
      contentWidth: 1600,
      contentHeight: 1000,
      placement: 'panel'
    })
    expect(panel.page.width).toBe(0)
    expect(panel.page.height).toBe(0)
    expect(panel.page.x).toBe(0)
    // Must NOT paint at contentWidth - W
    expect(panel.page.x).not.toBe(1600 - ABACO_BROWSER_PANEL_WIDTH_PX)
  })

  it('H3: F2 Grabar→Parar skill handoff always setDraft+submit (no empty catch)', async () => {
    const client = await readFile('packages/abaco-browser/client.js', 'utf8')
    expect(client).toContain('submitSkillToChat')
    expect(client).toContain('skillTextFromResult')
    expect(client).toContain('inputActions.setDraft')
    expect(client).toContain('inputActions.submit')
    expect(client).toContain('onScreenRecordingStopped')
    expect(client).toContain('__abacoBrowserSkillHandoffBound')
    expect(client).toContain('bridge skill handoff')
    // No silent empty catch swallowing handoff
    expect(client).not.toMatch(/onScreenRecordingStopped\([^)]*\)\s*=>\s*\{\s*\}/)
    const controller = await readFile('src/main/abaco-browser-controller.ts', 'utf8')
    expect(controller).toContain('handoffF2SkillToAgent')
    expect(controller).toContain('buildSkillHandoffMarkdown')
  })

  it('H4: click listeners re-attach on dom-ready and did-navigate', async () => {
    const controller = await readFile('src/main/abaco-browser-controller.ts', 'utf8')
    expect(controller).toContain("pageContents.on('dom-ready'")
    expect(controller).toContain("pageContents.on('did-navigate'")
    expect(controller).toContain('noteDomReady')
    // did-navigate path must re-call noteDomReady (not only noteNavigation)
    expect(controller).toMatch(/did-navigate[\s\S]*noteDomReady/u)
    const recorder = await readFile('src/main/abaco-browser-recorder.ts', 'utf8')
    expect(recorder).toContain('uninstallPageScript(true)')
    expect(recorder).toContain('installPageScript')
    expect(controller).not.toMatch(/\.setIgnoreMouseEvents\s*\(/)
    expect(recorder).not.toMatch(/\.setIgnoreMouseEvents\s*\(/)
  })

  it('H5: F1 broker/voice untouched; GITHUB_STABLE_FEED intact', async () => {
    const voice = await readFile('packages/abaco-voice/index.js', 'utf8')
    expect(voice).toContain('authorize(')
    const broker = await readFile('packages/abaco-effect-broker/index.js', 'utf8')
    expect(broker).toContain('export function authorize')
    const catalog = await readFile('src/main/update/version-catalog.ts', 'utf8')
    expect(catalog).toContain('GITHUB_STABLE_FEED')
    expect(catalog).toContain("provider: 'github'")
    expect(catalog).toContain('anthony-x507')
    expect(catalog).toContain('Abaco-deep-Core')
    const manager = await readFile('src/main/update/update-manager.ts', 'utf8')
    expect(manager).toContain('setFeedURL({ ...GITHUB_STABLE_FEED })')
    const pkg = await readFile('package.json', 'utf8')
    expect(pkg).toContain('"provider": "github"')
    expect(pkg).toContain('"notarize": false')
  })

  it('H6: no window.__abaco_ctx =; layout stash pattern only', async () => {
    const client = await readFile('packages/abaco-browser/client.js', 'utf8')
    expect(client).not.toMatch(/window\.__abaco_ctx\s*=/)
    expect(client).toContain('window.__abacoBrowserLayout')
    expect(client).toContain("inject = ['slots', 'layout']")
  })

  it('H7: dock reserve CSS + full-height host; launcher forces panel', async () => {
    const client = await readFile('packages/abaco-browser/client.js', 'utf8')
    expect(client).toContain('data-abaco-browser-dock')
    expect(client).toContain('applyDockReserve')
    expect(client).toContain('clearDockReserve')
    expect(client).toContain('grid-template-columns')
    expect(client).toContain('!important')
    expect(client).toContain('waitForDockReady')
    expect(client).toContain("setPlacement('panel')")
    expect(client).toContain('[class*="detailsCol"]')
    expect(client).toContain('rectsOverlap')
    const shared = await readFile('src/shared/abaco-browser.ts', 'utf8')
    expect(shared).toMatch(/REVOKED/u)
    expect(shared).toContain('ABACO_BROWSER_EMPTY_VIEW_BOUNDS')
    const hosted = computeAbacoBrowserSyncBounds({
      contentWidth: 1400,
      contentHeight: 900,
      placement: 'panel',
      hostBounds: { x: 980, y: 0, width: 420, height: 900 }
    })
    expect(hosted.page.height).toBe(900)
    expect(ABACO_BROWSER_DEFAULT_PLACEMENT).toBe('panel')
  })
})

