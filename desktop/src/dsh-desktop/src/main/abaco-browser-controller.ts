import { session, WebContentsView, type BrowserWindow, type WebContents } from 'electron'
import {
  ABACO_BROWSER_ACTION_MAX_TIMEOUT_MS,
  ABACO_BROWSER_ACTION_TIMEOUT_MS,
  ABACO_BROWSER_CHROME_HEIGHT,
  ABACO_BROWSER_CHROME_FOCUS_ADDRESS_CHANNEL,
  ABACO_BROWSER_CHROME_MIN_STATE_INTERVAL_MS,
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
  ABACO_BROWSER_THEME_CHANGED_CHANNEL,
  ABACO_BROWSER_WAIT_FOR_MAX_TIMEOUT_MS,
  ABACO_BROWSER_DEFAULT_PLACEMENT,
  ABACO_BROWSER_OPENED_CHANNEL,
  ABACO_BROWSER_CLOSED_CHANNEL,
  ABACO_BROWSER_SCREEN_RECORDING_STOPPED_CHANNEL,
  ABACO_BROWSER_WAIT_FOR_TIMEOUT_MS,
  buildSkillHandoffMarkdown,
  computeAbacoBrowserSyncBounds,
  abacoBrowserShortcutFor,
  isAbacoBrowserPlacement,
  isAbacoBrowserPanelHostBounds,
  isHttpUrl,
  normalizeBrowserUrl,
  type AbacoBrowserChromeState,
  type AbacoBrowserClickResult,
  type AbacoBrowserDomReading,
  type AbacoBrowserMode,
  type AbacoBrowserPanelHostBounds,
  type AbacoBrowserPlacement,
  type AbacoBrowserRecordingResult,
  type AbacoBrowserRecordingStatus,
  type AbacoBrowserScreenshot,
  type AbacoBrowserScreenRecordingResult,
  type AbacoBrowserScreenRecordingStatus,
  type AbacoBrowserShortcut,
  type AbacoBrowserState,
  type AbacoBrowserTheme,
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
import { AbacoBrowserRecorder, type AbacoBrowserRecorderPort } from './abaco-browser-recorder'
import { AbacoBrowserScreenRecorder } from './abaco-browser-screen-recorder'
import { writeBrowserSkillFromRecording } from './abaco-browser-skill-writer'

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
  /**
   * Where recordings are written: `<userData>/abaco-browser/recordings`. Main
   * passes it in because only main may touch `app.getPath`.
   */
  recordingsDir: string
  /**
   * Where screen recordings are written:
   * `<userData>/abaco-browser/screen-recordings`.
   */
  screenRecordingsDir: string
  /**
   * Where F3 / P1 auto-save writes `SKILL.md`:
   * `<DSH_HOME>/skills`.
   */
  skillsDir: string
  /**
   * Called when a preload in this overlay fails to load. Main owns the harness
   * log, so the controller reports the failure instead of deciding what to do
   * with it. Optional: the overlay still runs without a listener.
   */
  onPreloadError?: (preloadPath: string, error: unknown) => void
}

/**
 * Right-side / details-column web browser panel for the main ABACO DEEP HARNES window (P1).
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
 * P1 geometry: default {@link ABACO_BROWSER_DEFAULT_PLACEMENT} (`panel`) mounts
 * page + chrome as a CARD top-right of the reserved host track (width 420–560,
 * height 360–520, aspect ∈ [0.70, 1.30]; empty/no-mount without host). `overlay`
 * restores the F0 full-window cover (launcher must not open it). The chrome
 * strip still covers the card's first {@link ABACO_BROWSER_CHROME_HEIGHT} rows.
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
 *
 * ## F2 — chrome behaviour, recording and shortcuts
 *
 * Three responsibilities land here, all of them because main is the only place
 * that can see the browsed page:
 *
 *  - **the recorder's decoder.** {@link startRecording} installs the page-side
 *    listener script and this class subscribes to `console-message`, feeding
 *    every line to `AbacoBrowserRecorder`. Nothing consumed that channel before
 *    F2, which is why user actions were never recorded.
 *  - **navigation as a recorded action.** `will-navigate` and
 *    `did-navigate`/`did-navigate-in-page` are forwarded to the recorder, so a
 *    recording holds the pages the user visited and not only what they clicked.
 *  - **the accelerators.** The chrome strip has its own document and sees only
 *    the keystrokes that happen while *it* has focus; ⌘R/⌘W/⌘← typed into the
 *    page reach this class through `before-input-event` instead. Both surfaces
 *    map their event onto the same table
 *    ({@link abacoBrowserShortcutFor}) so they cannot disagree.
 */
export class AbacoBrowserController {
  private pageView: WebContentsView | undefined
  private chromeBarView: WebContentsView | undefined
  private mode: AbacoBrowserMode = ABACO_BROWSER_DEFAULT_MODE
  private disposed = false
  /** The Harness theme, pushed to the chrome bar so the strip is not OS-bound. */
  private theme: AbacoBrowserTheme = 'light'
  /** Trailing-publish timer behind {@link scheduleChromeState}. */
  private chromeStateTimer: NodeJS.Timeout | undefined
  private lastChromeStateAt = 0
  private readonly recorder: AbacoBrowserRecorder
  private readonly screenRecorder: AbacoBrowserScreenRecorder
  /** P1 — `panel` (default) or full-window `overlay`. */
  private placement: AbacoBrowserPlacement = ABACO_BROWSER_DEFAULT_PLACEMENT
  /** Optional details-column rect reported by the harness page. */
  private panelHostBounds: AbacoBrowserPanelHostBounds | null = null

  constructor(
    private readonly parent: BrowserWindow,
    private readonly paths: AbacoBrowserViewPaths
  ) {
    this.parent.once('closed', this.dispose)
    // The recorder talks to the page through this port, never through
    // `WebContents` directly: that is what keeps `abaco-browser-recorder.ts`
    // (and its tests) free of `electron`. Every method is a closure over
    // `this.pageView`, so it always addresses the *current* view.
    const port: AbacoBrowserRecorderPort = {
      pageInfo: () => {
        const contents = this.livePageContents()
        if (!contents) return { url: '', title: '' }
        return { url: contents.getURL(), title: contents.getTitle() }
      },
      evaluate: async (source: string) => {
        const contents = this.livePageContents()
        if (!contents) throw new Error(ABACO_BROWSER_NOT_OPEN_MESSAGE)
        return await contents.executeJavaScript(source, true)
      },
      capturePng: async () => {
        const contents = this.livePageContents()
        if (!contents) return undefined
        const image = await contents.capturePage()
        return image.isEmpty() ? undefined : image.toPNG()
      }
    }
    this.recorder = new AbacoBrowserRecorder({
      port,
      outputDir: paths.recordingsDir,
      log: (message) => console.warn(`[abaco-browser-recorder] ${message}`)
    })
    this.screenRecorder = new AbacoBrowserScreenRecorder({
      parent: this.parent,
      outputDir: paths.screenRecordingsDir,
      log: (message) => console.warn(`[abaco-browser-screen] ${message}`)
    })
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
      this.notifyHarness(ABACO_BROWSER_OPENED_CHANNEL)
      return
    }

    const target = url === undefined ? ABACO_BROWSER_DEFAULT_URL : normalizeBrowserUrl(url)
    // Abrir navegador must dock as panel; overlay is not reachable from the
    // launcher (agent/tests may still call setPlacement('overlay') explicitly).
    this.placement = ABACO_BROWSER_DEFAULT_PLACEMENT
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

    /* ── F2 — the recorder's decoder ────────────────────────────────────────
     * This subscription is the missing half of the recording feature: the page
     * script emits `console.log(PREFIX, json)` and nothing in the app read the
     * channel until F2. Electron 43 passes a single details object here
     * (`webContents.on('console-message', (details) => ...)`, with
     * `{ message, level, lineNumber, sourceId, frame }`; the positional
     * `(event, level, message, line, sourceId)` form is the deprecated one) —
     * the same shape `src/main/index.ts` already reads for renderer errors. */
    pageContents.on('console-message', (details) => {
      if (typeof details.message !== 'string') return
      this.recorder.consumeConsoleMessage(details.message)
    })
    // Navigation is an action too. `will-navigate` is the intent (only the main
    // frame matters), the two `did-*` events are the arrival; the recorder
    // collapses a matching pair into one step. The intent is filtered the way
    // the security handler above filters it, so a blocked `file:`/`javascript:`
    // navigation is not recorded as a step the user performed.
    pageContents.on('will-navigate', (event, url) => {
      if (!event.isMainFrame) return
      if (!isHttpUrl(url) && !url.startsWith('about:blank')) return
      this.recorder.noteNavigation('will-navigate', url)
    })
    pageContents.on('did-navigate', (_event, url) => {
      this.recorder.noteNavigation('did-navigate', url)
      // D-C — re-attach click listeners after navigations (dom-ready alone misses
      // some same-document / race cases; clicks must stay alive ≥5 times).
      void this.recorder.noteDomReady()
    })
    pageContents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (!isMainFrame) return
      this.recorder.noteNavigation('did-navigate-in-page', url)
      void this.recorder.noteDomReady()
    })
    // A new document means the recorder's listeners are gone with the old one.
    pageContents.on('dom-ready', () => {
      void this.recorder.noteDomReady()
    })
    // The page title is part of the chrome bar's state, and a single-page app
    // changes it without navigating.
    pageContents.on('page-title-updated', this.scheduleChromeState)
    // The accelerators typed *into the page*. `preventDefault` stops Chromium
    // from also acting on them (`⌘R` would reload behind the recorder's back).
    pageContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return
      const shortcut = abacoBrowserShortcutFor({
        key: input.key,
        meta: input.meta,
        ctrl: input.control,
        alt: input.alt,
        shift: input.shift
      })
      if (!shortcut) return
      event.preventDefault()
      this.runShortcut(shortcut)
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
    // The strip renders a fully inert document and does all of its work in this
    // preload, so a preload that fails to load leaves a visible but completely
    // dead address bar with no other trace. Report it to the harness log.
    chromeBarView.webContents.on('preload-error', (_event, preloadPath, error) => {
      this.paths.onPreloadError?.(preloadPath, error)
    })

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
    pageContents.on('did-start-loading', this.publishChromeState)
    chromeBarView.webContents.on('did-finish-load', this.publishChromeState)
    // The strip paints its own theme from the push, so it has to receive one as
    // soon as its document is alive — a page loaded later would never get one.
    chromeBarView.webContents.on('did-finish-load', this.publishTheme)

    this.syncBounds()
    void chromeBarView.webContents
      .loadFile(this.paths.chromeHtmlPath)
      .catch(this.reportLoadFailure)
    void pageContents.loadURL(target).catch(this.reportLoadFailure)
    this.focusPage()
    this.notifyHarness(ABACO_BROWSER_OPENED_CHANNEL)
  }

  /** Unmount the overlay and destroy both views; the launcher can open it again. */
  close(): void {
    // First, and deliberately before `this.pageView` is dropped: closing the
    // browser while a recording runs ends it and *saves* it, so a misclick on ✕
    // cannot throw away a demonstration the user just performed. `stop()` reads
    // the live page (final URL/title and the closing screenshot) through the
    // port, which addresses `this.pageView` — clearing the field first would
    // make both come back empty.
    if (this.recorder.isRecording()) {
      void this.recorder.stop().catch((error: unknown) => {
        console.warn('[abaco-browser-recorder] could not save the recording on close:', error)
      })
    }
    if (this.screenRecorder.isRecording()) {
      void this.screenRecorder.abort().catch((error: unknown) => {
        console.warn('[abaco-browser-screen] could not abort screen recording on close:', error)
      })
    }
    this.panelHostBounds = null
    this.placement = ABACO_BROWSER_DEFAULT_PLACEMENT
    if (this.chromeStateTimer !== undefined) {
      clearTimeout(this.chromeStateTimer)
      this.chromeStateTimer = undefined
    }

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
    this.notifyHarness(ABACO_BROWSER_CLOSED_CHANNEL)
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
   * button through the F0 IPC surface and by the agent's
   * `grab-control` / `release-control` RPC routes (same setter, two doors).
   * The Harness *page* preload still has no `setMode`, so ordinary page script
   * cannot flip ownership behind the user's back.
   */
  setBrowserMode(mode: AbacoBrowserMode): AbacoBrowserMode {
    this.mode = mode
    this.publishChromeState()
    return this.mode
  }

  /** Agent tool: take the wheel (`setBrowserMode('agent')`). Self-mounting. */
  agentGrabControl(): AbacoBrowserState {
    if (!this.isOpen()) this.open()
    this.setBrowserMode('agent')
    return this.agentState()
  }

  /** Agent tool: return the wheel to the user (`setBrowserMode('manual')`). */
  agentReleaseControl(): AbacoBrowserState {
    this.setBrowserMode('manual')
    return this.agentState()
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * P1 — placement (right panel vs full-window overlay)
   * ────────────────────────────────────────────────────────────────────────── */

  browserPlacement(): AbacoBrowserPlacement {
    return this.placement
  }

  setPlacement(placement: AbacoBrowserPlacement): AbacoBrowserPlacement {
    if (!isAbacoBrowserPlacement(placement)) {
      throw new Error('ABACO browser placement must be "panel" or "overlay".')
    }
    this.placement = placement
    this.syncBounds()
    return this.placement
  }

  /**
   * Harness page reports the reserved details-column host rect (DIP, content
   * coords). Pass `null` to clear. Panel placement without a host paints an
   * empty / no-mount rect — pin-derecha without reserved host is REVOKED.
   */
  reportPanelHostBounds(bounds: AbacoBrowserPanelHostBounds | null): void {
    if (bounds === null) {
      this.panelHostBounds = null
      this.syncBounds()
      return
    }
    if (!isAbacoBrowserPanelHostBounds(bounds)) {
      throw new Error('ABACO browser panel host bounds must be { x, y, width, height } numbers.')
    }
    this.panelHostBounds = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height
    }
    this.syncBounds()
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * P1 — desktopCapturer screen recording
   * ────────────────────────────────────────────────────────────────────────── */

  /** Start capturing the ABACO window's pixels via desktopCapturer. */
  async agentScreenRecordStart(): Promise<AbacoBrowserScreenRecordingStatus> {
    this.requirePageContents()
    const status = await this.screenRecorder.start()
    this.publishChromeState()
    return status
  }

  /**
   * Stop capturing and notify the agent: the returned `notice` + `path` are the
   * notification payload the tools surface in the tool result.
   */
  async agentScreenRecordStop(): Promise<AbacoBrowserScreenRecordingResult> {
    const result = await this.screenRecorder.stop()
    this.publishChromeState()
    if (result.ok) {
      const seconds =
        typeof result.durationMs === 'number' ? Math.round(result.durationMs / 1000) : 0
      const skillMarkdown = buildSkillHandoffMarkdown({
        title: 'Screen recording',
        actionDescriptions: [
          seconds > 0
            ? `Grabación de pantalla de ${seconds}s demostrando el flujo en la ventana ABACO.`
            : 'Grabación de pantalla demostrando el flujo en la ventana ABACO.'
        ],
        skillPath: result.path,
        recordingPath: result.path
      })
      const payload: AbacoBrowserScreenRecordingResult = {
        ...result,
        skillMarkdown,
        kind: 'screen'
      }
      this.notifyHarness(ABACO_BROWSER_SCREEN_RECORDING_STOPPED_CHANNEL, payload)
      return payload
    }
    return result
  }

  screenRecordingStatus(): AbacoBrowserScreenRecordingStatus {
    return this.screenRecorder.status()
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * F2 — recording, theme and accelerators
   * ────────────────────────────────────────────────────────────────────────── */

  /**
   * Start recording the user's actions in the overlay.
   *
   * Ownership is handed to the user *first*, before the first action can land:
   * a recording is a demonstration by a human, and an agent that kept clicking
   * while the user was showing how something is done would interleave its own
   * synthetic steps into the file. Since the agent's tools are gated on
   * {@link AbacoBrowserMode}, flipping to `manual` is what actually stops them —
   * and the chrome bar paints `MANUAL` next to the ⏺ for as long as it lasts.
   */
  async startRecording(): Promise<AbacoBrowserRecordingStatus> {
    this.requirePageContents()
    if (this.mode !== 'manual') this.setBrowserMode('manual')
    const status = await this.recorder.start(this.mode)
    this.publishChromeState()
    return status
  }

  /** Stop recording, write `<recordingsDir>/<timestamp>.json` (+ PNGs) and report where. */
  async stopRecording(): Promise<AbacoBrowserRecordingResult> {
    const result = await this.recorder.stop()
    this.publishChromeState()
    if (result.ok) {
      await this.handoffF2SkillToAgent(result)
    }
    return result
  }

  /**
   * P1 D4 — after F2 recordStop, auto-save the skill and push markdown to the
   * Harness page on the existing `screen-recording-stopped` channel so the
   * client can `setDraft` + `submit` (disk-only is not enough).
   */
  private async handoffF2SkillToAgent(result: AbacoBrowserRecordingResult): Promise<void> {
    try {
      const saved = await writeBrowserSkillFromRecording({
        recordingsDir: this.paths.recordingsDir,
        skillsDir: this.paths.skillsDir,
        ...(result.sessionId.length > 0 ? { recordingId: result.sessionId } : {})
      })
      const actionDescriptions =
        saved.ok && Array.isArray(saved.actionDescriptions) && saved.actionDescriptions.length > 0
          ? saved.actionDescriptions
          : saved.ok && saved.description
            ? [saved.description]
            : ['Grabación de acciones del navegador (F2).']
      const title = saved.ok && saved.name.length > 0 ? saved.name : 'browser-skill'
      const skillPath = saved.ok ? saved.path : result.path
      const skillMarkdown = buildSkillHandoffMarkdown({
        title,
        actionDescriptions,
        skillPath,
        recordingPath: result.path
      })
      const payload: AbacoBrowserScreenRecordingResult = {
        ok: true,
        path: result.path,
        sessionId: result.sessionId,
        durationMs: result.durationMs,
        mimeType: 'application/json',
        byteLength: 0,
        notice: saved.ok
          ? `Recording saved and skill "${saved.name}" written for the agent.`
          : `Recording saved at ${result.path}; skill auto-save failed: ${saved.error}`,
        skillMarkdown,
        kind: 'f2-actions',
        ...(saved.ok
          ? { skillPath: saved.path, skillName: saved.name }
          : {})
      }
      this.notifyHarness(ABACO_BROWSER_SCREEN_RECORDING_STOPPED_CHANNEL, payload)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const skillMarkdown = buildSkillHandoffMarkdown({
        title: 'browser-skill',
        actionDescriptions: [
          `Grabación F2 con ${result.actionCount} acción(es). Auto-save del skill falló: ${message}`
        ],
        skillPath: result.path,
        recordingPath: result.path
      })
      this.notifyHarness(ABACO_BROWSER_SCREEN_RECORDING_STOPPED_CHANNEL, {
        ok: true,
        path: result.path,
        sessionId: result.sessionId,
        durationMs: result.durationMs,
        mimeType: 'application/json',
        byteLength: 0,
        notice: `Recording saved; skill handoff error: ${message}`,
        skillMarkdown,
        kind: 'f2-actions'
      } satisfies AbacoBrowserScreenRecordingResult)
    }
  }

  /** Live recording state; also reads back the last session once it has stopped. */
  recordingStatus(): AbacoBrowserRecordingStatus {
    return this.recorder.status()
  }

  /**
   * The Harness's resolved theme, pushed to the chrome strip. The strip has its
   * own `prefers-color-scheme`, but the user's Harness appearance is the
   * authority: a dark Harness on a light OS must not open a white browser bar.
   * `src/main/index.ts` calls this from `syncNativeTheme`, which is where the
   * Harness theme is already resolved for the native chrome.
   */
  setTheme(theme: AbacoBrowserTheme): void {
    this.theme = theme
    this.publishTheme()
  }

  /**
   * Answer one accelerator, whichever surface saw it.
   *
   * Two callers, one implementation: the page view's `before-input-event` (the
   * only place that sees a keystroke typed into the *browsed page*) and the
   * `abaco:browser:shortcut` IPC handler, which the chrome strip invokes from its
   * own `keydown`. Both resolve the same key table
   * ({@link abacoBrowserShortcutFor}), so ⌘R means one thing whichever surface
   * has focus.
   */
  runShortcut(shortcut: AbacoBrowserShortcut): boolean {
    if (!this.isOpen()) return false
    switch (shortcut) {
      case 'focus-address':
        // Focus moves to the strip's document; its preload turns that into a
        // focus+select of the address input.
        this.chromeBarView?.webContents.focus()
        this.chromeBarView?.webContents.send(ABACO_BROWSER_CHROME_FOCUS_ADDRESS_CHANNEL)
        return true
      case 'reload':
        this.reload()
        return true
      case 'close':
        this.close()
        return true
      case 'back':
        return this.back()
      case 'forward':
        return this.forward()
      default:
        return false
    }
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
    const screen = this.screenRecorder.status()
    if (!contents || contents.isDestroyed()) {
      return {
        open: false,
        mode: this.mode,
        url: '',
        title: '',
        loading: false,
        canGoBack: false,
        canGoForward: false,
        screenRecording: screen.recording,
        lastScreenRecordingPath: screen.lastRecordingPath
      }
    }
    return {
      open: true,
      mode: this.mode,
      url: contents.getURL(),
      title: contents.getTitle(),
      loading: contents.isLoading(),
      canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward(),
      screenRecording: screen.recording,
      lastScreenRecordingPath: screen.lastRecordingPath
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
   * Keep both views glued to the active placement geometry. Pure math lives in
   * {@link computeAbacoBrowserSyncBounds}; this method only reads window size /
   * host bounds and applies the result. Panel without host → empty bounds
   * (do not paint over chat). Mouse events stay on the page WebContentsView
   * while open (never ignore-mouse on the panel).
   */
  private readonly syncBounds = (): void => {
    const pageView = this.pageView
    const chromeBarView = this.chromeBarView
    if (!pageView || !chromeBarView) return
    if (this.disposed || this.parent.isDestroyed()) return
    const { width, height } = this.parent.getContentBounds()
    const { page, chrome } = computeAbacoBrowserSyncBounds({
      contentWidth: width,
      contentHeight: height,
      placement: this.placement,
      hostBounds: this.panelHostBounds,
      chromeHeight: ABACO_BROWSER_CHROME_HEIGHT
    })
    pageView.setBounds(page)
    chromeBarView.setBounds(chrome)
  }

  /** Push the current address/history/mode/recording state to the chrome bar. */
  private readonly publishChromeState = (): void => {
    this.lastChromeStateAt = Date.now()
    const chromeBar = this.chromeBarWebContents()
    const contents = this.pageView?.webContents
    if (!chromeBar || !contents || contents.isDestroyed()) return
    const status = this.recorder.status()
    const state: AbacoBrowserChromeState = {
      url: contents.getURL(),
      title: contents.getTitle(),
      canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward(),
      loading: contents.isLoading(),
      mode: this.mode,
      recording: status.recording,
      recordingActions: status.recording ? status.actionCount : 0,
      // F3 — the strip offers 💾 only for a recording that is *finished*:
      // `lastRecordingPath` is empty while one is running and is set by the
      // write that ends it, so the button cannot appear over a half-written
      // session.
      hasRecording: !status.recording && status.lastRecordingPath.length > 0,
      lastRecordingId: status.recording ? '' : status.sessionId,
      screenRecording: this.screenRecorder.isRecording(),
      placement: this.placement
    }
    chromeBar.send(ABACO_BROWSER_CHROME_STATE_CHANNEL, state)
  }

  /**
   * Publish at most once per {@link ABACO_BROWSER_CHROME_MIN_STATE_INTERVAL_MS}:
   * immediately when the last push is old enough, otherwise once on a trailing
   * timer, so the strip always ends up showing the *final* state of a burst
   * (the last keystroke, the last title change) rather than an intermediate one.
   */
  private readonly scheduleChromeState = (): void => {
    const elapsed = Date.now() - this.lastChromeStateAt
    if (elapsed >= ABACO_BROWSER_CHROME_MIN_STATE_INTERVAL_MS) {
      this.publishChromeState()
      return
    }
    if (this.chromeStateTimer !== undefined) return
    this.chromeStateTimer = setTimeout(() => {
      this.chromeStateTimer = undefined
      this.publishChromeState()
    }, ABACO_BROWSER_CHROME_MIN_STATE_INTERVAL_MS - elapsed)
  }

  /** Push the resolved theme to the strip. */
  private readonly publishTheme = (): void => {
    const chromeBar = this.chromeBarWebContents()
    if (!chromeBar) return
    chromeBar.send(ABACO_BROWSER_THEME_CHANGED_CHANNEL, this.theme)
  }

  /**
   * The page's `WebContents` while it is alive and usable, or `undefined`. Used
   * by the recorder's port, which must be able to ask "is there still a page?"
   * without throwing: it runs from a timer and from teardown paths where a
   * closed overlay is a normal condition, not an error.
   */
  private livePageContents(): WebContents | undefined {
    const view = this.pageView
    if (this.disposed || !view || view.webContents.isDestroyed()) return undefined
    return view.webContents
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

  /**
   * Push a one-shot fact to the Harness page (opened / closed / screen
   * recording stopped). The chrome bar has its own channels; this is the
   * page-side door the client plugin listens on.
   */
  private notifyHarness(channel: string, payload?: unknown): void {
    if (this.parent.isDestroyed()) return
    const contents = this.parent.webContents
    if (!contents || contents.isDestroyed()) return
    contents.send(channel, payload)
  }

  private readonly dispose = (): void => {
    if (this.disposed) return
    this.close()
    this.disposed = true
  }
}
