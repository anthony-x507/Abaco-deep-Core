import { session, WebContentsView, type BrowserWindow, type WebContents } from 'electron'
import {
  ABACO_BROWSER_CHROME_HEIGHT,
  ABACO_BROWSER_CHROME_STATE_CHANNEL,
  ABACO_BROWSER_DEFAULT_URL,
  ABACO_BROWSER_PARTITION,
  isHttpUrl,
  normalizeBrowserUrl,
  type AbacoBrowserChromeState
} from '../shared/abaco-browser'

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
 */
export class AbacoBrowserController {
  private pageView: WebContentsView | undefined
  private chromeBarView: WebContentsView | undefined
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

  /** Push the current address/history state to the chrome bar. */
  private readonly publishChromeState = (): void => {
    const chromeBar = this.chromeBarWebContents()
    const contents = this.pageView?.webContents
    if (!chromeBar || !contents || contents.isDestroyed()) return
    const state: AbacoBrowserChromeState = {
      url: contents.getURL(),
      canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward(),
      loading: contents.isLoading()
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
      throw new Error('The ABACO browser overlay is not open.')
    }
    return view.webContents
  }

  private readonly dispose = (): void => {
    if (this.disposed) return
    this.close()
    this.disposed = true
  }
}
