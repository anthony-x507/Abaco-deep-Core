import { session, WebContentsView, type BrowserWindow, type WebContents } from 'electron'
import {
  ABACO_BROWSER_ACTION_MAX_TIMEOUT_MS,
  ABACO_BROWSER_ACTION_TIMEOUT_MS,
  ABACO_BROWSER_CHROME_HEIGHT,
  ABACO_BROWSER_CHROME_STATE_CHANNEL,
  ABACO_BROWSER_DEFAULT_MODE,
  ABACO_BROWSER_DEFAULT_URL,
  ABACO_BROWSER_NAVIGATE_SETTLE_MS,
  ABACO_BROWSER_NOT_OPEN_MESSAGE,
  ABACO_BROWSER_PARTITION,
  ABACO_BROWSER_READ_DOM_MAX_CHARS,
  ABACO_BROWSER_READ_DOM_MAX_CHARS_CEILING,
  ABACO_BROWSER_READ_DOM_MAX_HEADINGS,
  ABACO_BROWSER_READ_DOM_MAX_LINKS,
  ABACO_BROWSER_RPC_GRACE_MS,
  ABACO_BROWSER_TAKEOVER_MESSAGE,
  ABACO_BROWSER_WAIT_FOR_MAX_TIMEOUT_MS,
  ABACO_BROWSER_WAIT_FOR_TIMEOUT_MS,
  isHttpUrl,
  normalizeBrowserUrl,
  type AbacoBrowserChromeState,
  type AbacoBrowserClickResult,
  type AbacoBrowserDomReading,
  type AbacoBrowserMode,
  type AbacoBrowserScreenshot,
  type AbacoBrowserState,
  type AbacoBrowserTypingResult,
  type AbacoBrowserWaitResult
} from '../shared/abaco-browser'
import {
  clickInPage,
  readDomInPage,
  typeInPage,
  waitForInPage,
  type PageDomReading,
  type PageElementRef
} from './abaco-browser-page-scripts'

/**
 * Clamp a caller-supplied budget to a sane range.
 *
 * The agent composes these numbers, so both ends matter: a missing or nonsensical
 * value falls back to the default rather than to zero (which would turn every
 * selector wait into an instant failure) and the ceiling keeps one tool call
 * from parking the harness for an hour.
 */
function normalizeBudget(value: unknown, fallback: number, ceiling: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback
  return Math.min(Math.floor(value), ceiling)
}

export interface AbacoBrowserViewPaths {
  /** `build/abaco-browser-chrome.html`, or its copy in the packaged resources. */
  chromeHtmlPath: string
  /** `out/preload/abaco-browser-chrome.cjs`. */
  chromePreloadPath: string
}

/**
 * Full-window web browser overlay for the main ABACO DEEP HARNES window.
 *
 * The Harness chat stays exactly where it is: it keeps being the window's own
 * `webContents` and is never re-parented, reloaded or otherwise touched. The
 * browser is two sibling child views stacked on top of it inside
 * `window.contentView` (the same mechanism `safe-mode-overlay.ts` uses for its
 * backdrop and `attachWindowsMenuView` for the Windows menu):
 *
 *   - `pageView`   — the browsed page. It runs in its own session partition
 *                    (`persist:abaco-browser`) so it can never read the Harness
 *                    cookies, and it is deliberately NOT passed through
 *                    `secureWindow`: blocking external navigation is the whole
 *                    point of a browser, while the partition plus the strict
 *                    permission/download handlers keep the blast radius small.
 *   - `chromeBarView` — the local `abaco-browser-chrome.html` strip. It is added
 *                    last, so child-view stacking paints it above the page.
 *
 * F0 geometry decision: the page view covers the entire content rect and the
 * opaque chrome strip is laid over its first {@link ABACO_BROWSER_CHROME_HEIGHT}
 * rows. That keeps `syncBounds` a pure function of the window size (no per-view
 * arithmetic to get wrong on resize/fullscreen) and matches the requested
 * "covers the whole window, chrome on top" behaviour. Keeping the page alive
 * under the strip is also the natural seam for F1+, where the strip may become
 * translucent or animate.
 *
 * `close()` only removes the overlay and destroys its views, so the launcher can
 * open it again; `dispose()` (bound to the window's `closed` event) is the
 * permanent teardown. F0 deliberately drops the browsing session on close —
 * keeping it alive is an F1 item, see `docs/abaco-browser.md`.
 *
 * ## F1 — the agent surface
 *
 * The `agent*` methods are the whole surface `abaco-browser-rpc.ts` exposes to
 * the agent's tools, and they differ from the F0 user-facing commands in three
 * ways:
 *
 *  1. they are gated by {@link AbacoBrowserMode} — in `manual` mode the user
 *     owns the page and every mutating action is refused with
 *     {@link ABACO_BROWSER_TAKEOVER_MESSAGE};
 *  2. they resolve *after* the page settles instead of firing and forgetting,
 *     so a tool's result describes the state its own action produced;
 *  3. they run page code through {@link runInPage}, i.e. inside the browsed
 *     document, never in the shell.
 */
export class AbacoBrowserController {
  private pageView: WebContentsView | undefined
  private chromeBarView: WebContentsView | undefined
  private mode: AbacoBrowserMode = ABACO_BROWSER_DEFAULT_MODE
  private disposed = false

  constructor(
    private readonly parent: BrowserWindow,
    private readonly paths: AbacoBrowserViewPaths
  ) {
    this.parent.once('closed', this.dispose)
  }

  /** True while the overlay is mounted and usable. */
  isOpen(): boolean {
    const view = this.pageView
    return !this.disposed && !this.parent.isDestroyed() && view !== undefined &&
      !view.webContents.isDestroyed()
  }

  /**
   * WebContents of the chrome bar, or `undefined` while the overlay is closed.
   * `src/main/index.ts` uses it to accept IPC from the bar and from the harness
   * page only.
   */
  chromeBarWebContents(): WebContents | undefined {
    const view = this.chromeBarView
    if (!view) return undefined
    return view.webContents.isDestroyed() ? undefined : view.webContents
  }

  /**
   * Mount the overlay and load `url` (the default page when omitted). Calling
   * `open()` while already open keeps the current page unless a URL is given,
   * which makes the launcher button and an agent-side "open this link" call
   * both idempotent.
   */
  open(url?: string): void {
    if (this.disposed || this.parent.isDestroyed()) {
      throw new Error('The ABACO DEEP HARNES window is no longer available.')
    }
    if (this.isOpen()) {
      if (url !== undefined) this.navigate(url)
      this.focusPage()
      return
    }

    const target = url === undefined ? ABACO_BROWSER_DEFAULT_URL : normalizeBrowserUrl(url)
    this.hardenBrowserSession()

    const pageView = new WebContentsView({
      webPreferences: {
        partition: ABACO_BROWSER_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true
      }
    })
    const pageContents = pageView.webContents

    // `window.open`/`target=_blank` must not spawn new native windows: the
    // overlay owns exactly one browsing surface, so the target is loaded in it.
    pageContents.setWindowOpenHandler((details) => {
      if (isHttpUrl(details.url)) void pageContents.loadURL(details.url).catch(this.reportLoadFailure)
      return { action: 'deny' }
    })
    // A remote page may navigate itself, but never out of the web: local and
    // privileged schemes are refused in the main frame.
    pageContents.on('will-navigate', (event, url) => {
      if (!event.isMainFrame) return
      if (isHttpUrl(url) || url.startsWith('about:blank')) return
      event.preventDefault()
      console.warn(`[abaco-browser] blocked navigation to ${url}`)
    })

    const chromeBarView = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        preload: this.paths.chromePreloadPath
      }
    })
    chromeBarView.setBackgroundColor('#00000000')
    chromeBarView.webContents.setZoomFactor(1)

    this.pageView = pageView
    this.chromeBarView = chromeBarView
    this.parent.contentView.addChildView(pageView)
    // Added second: sibling child views stack in insertion order, so the strip
    // paints above the page.
    this.parent.contentView.addChildView(chromeBarView)

    this.parent.on('resize', this.syncBounds)
    this.parent.on('enter-full-screen', this.syncBounds)
    this.parent.on('leave-full-screen', this.syncBounds)
    pageContents.on('did-navigate', this.publishChromeState)
    pageContents.on('did-navigate-in-page', this.publishChromeState)
    pageContents.on('did-stop-loading', this.publishChromeState)
    pageContents.on('did-fail-load', this.publishChromeState)
    chromeBarView.webContents.on('did-finish-load', this.publishChromeState)

    this.syncBounds()
    void chromeBarView.webContents
      .loadFile(this.paths.chromeHtmlPath)
      .catch(this.reportLoadFailure)
    void pageContents.loadURL(target).catch(this.reportLoadFailure)
    this.focusPage()
  }

  /** Unmount the overlay and destroy both views; the launcher can open it again. */
  close(): void {
    const pageView = this.pageView
    const chromeBarView = this.chromeBarView
    this.pageView = undefined
    this.chromeBarView = undefined

    this.parent.removeListener('resize', this.syncBounds)
    this.parent.removeListener('enter-full-screen', this.syncBounds)
    this.parent.removeListener('leave-full-screen', this.syncBounds)

    if (!this.disposed && !this.parent.isDestroyed()) {
      if (pageView) this.parent.contentView.removeChildView(pageView)
      if (chromeBarView) this.parent.contentView.removeChildView(chromeBarView)
    }
    if (pageView && !pageView.webContents.isDestroyed()) pageView.webContents.close()
    if (chromeBarView && !chromeBarView.webContents.isDestroyed()) chromeBarView.webContents.close()
    this.browserSession().removeListener('will-download', this.blockDownload)

    if (!this.disposed && !this.parent.isDestroyed() && this.parent.isFocused()) {
      this.parent.webContents.focus()
    }
  }

  /** Load `url` in the overlay, assuming https when no scheme was typed. */
  navigate(url: string): void {
    const contents = this.requirePageContents()
    const target = normalizeBrowserUrl(url)
    void contents.loadURL(target).catch(this.reportLoadFailure)
  }

  /** Returns false when there is nothing to go back to. */
  back(): boolean {
    const contents = this.requirePageContents()
    if (!contents.navigationHistory.canGoBack()) return false
    contents.navigationHistory.goBack()
    return true
  }

  /** Returns false when there is nothing to go forward to. */
  forward(): boolean {
    const contents = this.requirePageContents()
    if (!contents.navigationHistory.canGoForward()) return false
    contents.navigationHistory.goForward()
    return true
  }

  reload(): void {
    this.requirePageContents().reload()
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * F1 — takeover ownership
   * ────────────────────────────────────────────────────────────────────────── */

  /** Who owns the overlay right now (`agent` unless the user took over). */
  browserMode(): AbacoBrowserMode {
    return this.mode
  }

  /**
   * Hand ownership to the agent or to the user. Called by the chrome bar's mode
   * button through the F0 IPC surface; the agent cannot flip it (no RPC route
   * touches it), which is what keeps a runaway tool from lifting its own gate.
   */
  setBrowserMode(mode: AbacoBrowserMode): AbacoBrowserMode {
    this.mode = mode
    this.publishChromeState()
    return this.mode
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * F1 — agent actions
   * ────────────────────────────────────────────────────────────────────────── */

  /**
   * What the agent is allowed to observe at any time — deliberately *not*
   * gated, so a refusal can always be explained. A gated `state` would leave the
   * model unable to distinguish "the user has the wheel" from "the browser is
   * closed", which are the two things it needs to report.
   */
  agentState(): AbacoBrowserState {
    const contents = this.isOpen() ? this.pageView?.webContents : undefined
    if (!contents || contents.isDestroyed()) {
      return {
        open: false,
        mode: this.mode,
        url: '',
        title: '',
        loading: false,
        canGoBack: false,
        canGoForward: false
      }
    }
    return {
      open: true,
      mode: this.mode,
      url: contents.getURL(),
      title: contents.getTitle(),
      loading: contents.isLoading(),
      canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward()
    }
  }

  /**
   * Load `url` for the agent, mounting the overlay first when it is closed —
   * this is the F0 backlog's "agent-side seam so a tool can open a URL in the
   * overlay through the same controller". Resolves once the page has stopped
   * loading (bounded by {@link ABACO_BROWSER_NAVIGATE_SETTLE_MS}), so the
   * returned state already carries the destination's title.
   */
  async agentNavigate(url: string, timeoutMs = ABACO_BROWSER_NAVIGATE_SETTLE_MS): Promise<AbacoBrowserState> {
    this.requireAgentControl()
    // Normalize before touching the views: a refused scheme must leave the
    // current page exactly as it was.
    const target = normalizeBrowserUrl(url)
    if (!this.isOpen()) {
      this.open(target)
      await this.nextLoadSettled(this.requirePageContents(), timeoutMs)
      return this.agentState()
    }
    const contents = this.requirePageContents()
    const settled = this.nextLoadSettled(contents, timeoutMs)
    void contents.loadURL(target).catch(this.reportLoadFailure)
    await settled
    return this.agentState()
  }

  /** Click the first element matching `selector`, waiting for it to appear. */
  async agentClick(
    selector: string,
    timeoutMs?: number
  ): Promise<AbacoBrowserClickResult> {
    this.requireAgentControl()
    const budget = normalizeBudget(timeoutMs, ABACO_BROWSER_ACTION_TIMEOUT_MS, ABACO_BROWSER_ACTION_MAX_TIMEOUT_MS)
    const element = await this.runInPage<PageElementRef>(
      clickInPage,
      [selector, budget],
      budget + ABACO_BROWSER_RPC_GRACE_MS
    )
    return { element }
  }

  /** Write `text` into `selector`, optionally pressing Enter afterwards. */
  async agentType(
    selector: string,
    text: string,
    options: { submit?: boolean; timeoutMs?: number } = {}
  ): Promise<AbacoBrowserTypingResult> {
    this.requireAgentControl()
    const budget = normalizeBudget(
      options.timeoutMs,
      ABACO_BROWSER_ACTION_TIMEOUT_MS,
      ABACO_BROWSER_ACTION_MAX_TIMEOUT_MS
    )
    const result = await this.runInPage<PageElementRef & { wrote: boolean }>(
      typeInPage,
      [selector, text, options.submit === true, budget],
      budget + ABACO_BROWSER_RPC_GRACE_MS
    )
    return {
      element: { selector: result.selector, tag: result.tag, text: result.text },
      wrote: result.wrote === true,
      submitted: options.submit === true && result.wrote === true
    }
  }

  /** Read the page as text plus headings and links. */
  async agentReadDom(options: { maxChars?: number } = {}): Promise<AbacoBrowserDomReading> {
    const contents = this.requireAgentControl()
    const maxChars = normalizeBudget(
      options.maxChars,
      ABACO_BROWSER_READ_DOM_MAX_CHARS,
      ABACO_BROWSER_READ_DOM_MAX_CHARS_CEILING
    )
    const reading = await this.runInPage<PageDomReading>(
      readDomInPage,
      [maxChars, ABACO_BROWSER_READ_DOM_MAX_HEADINGS, ABACO_BROWSER_READ_DOM_MAX_LINKS],
      ABACO_BROWSER_ACTION_TIMEOUT_MS + ABACO_BROWSER_RPC_GRACE_MS
    )
    return {
      url: contents.getURL(),
      title: contents.getTitle(),
      text: reading.text,
      charCount: reading.charCount,
      truncated: reading.truncated,
      headings: reading.headings,
      links: reading.links
    }
  }

  /** Wait until `selector` exists in the page. */
  async agentWaitFor(
    selector: string,
    timeoutMs?: number
  ): Promise<AbacoBrowserWaitResult> {
    this.requireAgentControl()
    const budget = normalizeBudget(
      timeoutMs,
      ABACO_BROWSER_WAIT_FOR_TIMEOUT_MS,
      ABACO_BROWSER_WAIT_FOR_MAX_TIMEOUT_MS
    )
    const startedAt = Date.now()
    const element = await this.runInPage<PageElementRef>(
      waitForInPage,
      [selector, budget],
      budget + ABACO_BROWSER_RPC_GRACE_MS
    )
    return { element, waitedMs: Date.now() - startedAt }
  }

  /**
   * Capture the visible page as PNG bytes.
   *
   * `capturePage()` rasterizes what the view is actually painting, so it also
   * fails when the overlay was never shown (an occluded or unparented view
   * captures an empty image) — that is reported rather than returned as a
   * zero-byte PNG.
   */
  async agentScreenshot(): Promise<AbacoBrowserScreenshot> {
    const contents = this.requireAgentControl()
    const image = await contents.capturePage()
    if (image.isEmpty()) {
      throw new Error(
        'The ABACO browser could not capture the page: the overlay is not painting (is the window visible?).'
      )
    }
    const png = image.toPNG()
    const { width, height } = image.getSize()
    return {
      mimeType: 'image/png',
      width,
      height,
      byteLength: png.byteLength,
      dataBase64: png.toString('base64')
    }
  }

  /**
   * Keep both views glued to the window's content rect. F0's layout: the page
   * fills the window, the chrome strip covers its first rows. Also the window's
   * `resize` handler.
   */
  private readonly syncBounds = (): void => {
    const pageView = this.pageView
    const chromeBarView = this.chromeBarView
    if (!pageView || !chromeBarView) return
    if (this.disposed || this.parent.isDestroyed()) return
    const { width, height } = this.parent.getContentBounds()
    const contentWidth = Math.max(0, Math.floor(width))
    const contentHeight = Math.max(0, Math.floor(height))
    pageView.setBounds({ x: 0, y: 0, width: contentWidth, height: contentHeight })
    chromeBarView.setBounds({
      x: 0,
      y: 0,
      width: contentWidth,
      height: Math.min(ABACO_BROWSER_CHROME_HEIGHT, contentHeight)
    })
  }

  /** Push the current address/history/mode state to the chrome bar. */
  private readonly publishChromeState = (): void => {
    const chromeBar = this.chromeBarWebContents()
    const contents = this.pageView?.webContents
    if (!chromeBar || !contents || contents.isDestroyed()) return
    const state: AbacoBrowserChromeState = {
      url: contents.getURL(),
      canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward(),
      loading: contents.isLoading(),
      mode: this.mode
    }
    chromeBar.send(ABACO_BROWSER_CHROME_STATE_CHANNEL, state)
  }

  /**
   * The isolated partition is also the security boundary: the browsed page gets
   * no camera, microphone, geolocation, notifications or clipboard-read grant,
   * and F0 keeps the overlay readonly by cancelling downloads (a file dropped
   * by an arbitrary page would land with no UI to track it — F1 can add a
   * download surface).
   */
  private hardenBrowserSession(): void {
    const browserSession = this.browserSession()
    browserSession.setPermissionCheckHandler(() => false)
    browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
    browserSession.removeListener('will-download', this.blockDownload)
    browserSession.on('will-download', this.blockDownload)
  }

  private browserSession(): Electron.Session {
    return session.fromPartition(ABACO_BROWSER_PARTITION)
  }

  private readonly blockDownload = (event: { preventDefault: () => void }): void => {
    event.preventDefault()
    console.warn('[abaco-browser] downloads are disabled in this browser build')
  }

  private readonly reportLoadFailure = (error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error)
    // A navigation superseded by another one rejects with ERR_ABORTED; that is
    // the normal outcome of clicking a second link mid-load and not an error.
    if (message.includes('ERR_ABORTED')) return
    console.warn('[abaco-browser] navigation failed:', message)
  }

  private focusPage(): void {
    const view = this.pageView
    if (!view || view.webContents.isDestroyed()) return
    view.webContents.focus()
  }

  private requirePageContents(): WebContents {
    const view = this.pageView
    if (this.disposed || !view || view.webContents.isDestroyed()) {
      throw new Error(ABACO_BROWSER_NOT_OPEN_MESSAGE)
    }
    return view.webContents
  }

  /**
   * The F1 gate. Every mutating agent action passes through it, and so does the
   * page itself: in manual mode the user owns the overlay, and an agent that
   * kept clicking would be fighting a human for one cursor — the exact
   * interleaving the upstream `takeover-controller` exists to prevent. The gate
   * lives in the controller rather than in the RPC server so it cannot be
   * bypassed by a future second caller.
   */
  private requireAgentControl(): WebContents {
    const contents = this.requirePageContents()
    if (this.mode !== 'agent') throw new Error(ABACO_BROWSER_TAKEOVER_MESSAGE)
    return contents
  }

  /**
   * Evaluate `body` inside the browsed page, with `args` passed explicitly.
   *
   * `executeJavaScript` takes source, so the function is serialized; see
   * `abaco-browser-page-scripts.ts` for why every body must be free of
   * enclosing-scope references. `userGesture: true` marks the evaluation the way
   * a real input event would, which pages that gate behaviour behind
   * "user activation" (popovers, clipboard, autoplay) check before acting.
   *
   * The page's own budget is enforced by the body's polling loop; the race timer
   * here is the backstop for a renderer that never answers at all.
   */
  private async runInPage<T>(body: (...args: never[]) => unknown, args: unknown[], timeoutMs: number): Promise<T> {
    const contents = this.requirePageContents()
    const source = `(${body.toString()})(${args.map((value) => JSON.stringify(value) ?? 'null').join(', ')})`
    let timer: NodeJS.Timeout | undefined
    try {
      return (await Promise.race([
        contents.executeJavaScript(source, true) as Promise<T>,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error(`The page did not answer within ${timeoutMs} ms.`)),
            timeoutMs
          )
        })
      ])) as T
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  /**
   * Resolve once the view has stopped loading, or after `timeoutMs`.
   *
   * Subscribing *before* the caller issues the load is what makes this
   * race-free, so every caller starts the promise first and navigates second.
   * A timeout is not an error: an agent navigation that reports `loading: true`
   * is more useful than one that fails, because the model can then wait for a
   * selector instead of guessing how long the site takes.
   */
  private nextLoadSettled(contents: WebContents, timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve) => {
      let timer: NodeJS.Timeout | undefined
      const settle = (): void => {
        if (timer !== undefined) clearTimeout(timer)
        contents.removeListener('did-stop-loading', settle)
        contents.removeListener('did-fail-load', settle)
        resolve()
      }
      timer = setTimeout(settle, timeoutMs)
      contents.once('did-stop-loading', settle)
      contents.once('did-fail-load', settle)
    })
  }

  private readonly dispose = (): void => {
    if (this.disposed) return
    this.close()
    this.disposed = true
  }
}
