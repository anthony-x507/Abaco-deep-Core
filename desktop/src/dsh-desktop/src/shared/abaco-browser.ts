/**
 * Shared contract of the ABACO DEEP HARNES integrated browser (F0).
 *
 * The browser is an overlay `WebContentsView` owned by the main process; the
 * harness page and the browser's own chrome bar are both thin clients of the
 * same IPC surface. Keeping the channel names, the geometry constant and the
 * URL normalization in one module keeps main, the harness preload and the
 * chrome-bar preload from drifting apart (the same reason `desktop-menu.ts`
 * exists for the Windows menu).
 */

/** Page the overlay opens when the launcher asks for a browser with no target. */
export const ABACO_BROWSER_DEFAULT_URL = 'https://www.google.com'

/**
 * Dedicated session partition for the browsed page. The overlay must never
 * share cookies, storage or cache with the Harness renderer, which lives in the
 * default session and carries the local Harness authentication cookie.
 */
export const ABACO_BROWSER_PARTITION = 'persist:abaco-browser'

/**
 * Height of the chrome bar strip in device-independent pixels. F0 paints the
 * page across the whole window and lays this opaque strip over its first rows,
 * so the constant is the only geometry the two views share.
 */
export const ABACO_BROWSER_CHROME_HEIGHT = 44

/** `ipcMain.handle` channels that drive the overlay. */
export const abacoBrowserChannels = {
  open: 'abaco:browser:open',
  close: 'abaco:browser:close',
  navigate: 'abaco:browser:navigate',
  back: 'abaco:browser:back',
  forward: 'abaco:browser:forward',
  reload: 'abaco:browser:reload',
  isOpen: 'abaco:browser:isOpen'
} as const

/** Main → chrome-bar push of the current navigation state. */
export const ABACO_BROWSER_CHROME_STATE_CHANNEL = 'abaco-browser-chrome:navigated'

export interface AbacoBrowserChromeState {
  url: string
  canGoBack: boolean
  canGoForward: boolean
  loading: boolean
}

/** Result shape of every control channel except `isOpen`, which returns a boolean. */
export interface AbacoBrowserCommandResult {
  ok: boolean
}

/** True for the only two schemes the overlay is allowed to load. */
export function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Turn whatever the user typed in the address bar into an absolute http(s)
 * URL, or refuse it. A bare host (`example.com`) is assumed to be https; a
 * different scheme (`file:`, `javascript:`, `data:`) is rejected before it can
 * reach `loadURL`.
 */
export function normalizeBrowserUrl(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    throw new Error('A URL is required to open the ABACO browser.')
  }
  if (/^[a-z][a-z\d+.-]*:/iu.test(trimmed)) {
    if (!isHttpUrl(trimmed)) {
      throw new Error('The ABACO browser only opens http and https addresses.')
    }
    return trimmed
  }
  const candidate = `https://${trimmed}`
  if (!isHttpUrl(candidate)) {
    throw new Error(`"${raw}" is not a valid address.`)
  }
  return candidate
}
