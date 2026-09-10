/**
 * Shared contract of the ABACO DEEP HARNES integrated browser (F0 + F1).
 *
 * The browser is an overlay `WebContentsView` owned by the main process; the
 * harness page, the browser's own chrome bar and — since F1 — the agent's tools
 * are all thin clients of the same surface. Keeping the channel names, the
 * geometry constant, the URL normalization and the F1 control-plane constants
 * in one module keeps main, both preloads and the loopback RPC server from
 * drifting apart (the same reason `desktop-menu.ts` exists for the Windows
 * menu).
 *
 * F1 adds a second entry point: the agent's tools run in the Harness Node child
 * process, not in Electron, so they reach the controller over a loopback HTTP
 * RPC whose port and token main injects through the child's environment. The
 * `ABACO_BROWSER_CTRL_*` names below are that seam's contract;
 * `packages/abaco-browser/index.js` cannot import this module (it is a separate
 * plugin package resolved inside the Harness profile), so it restates the same
 * two literals and `test/abaco-browser.test.ts` asserts the two copies agree.
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
  isOpen: 'abaco:browser:isOpen',
  mode: 'abaco:browser:mode',
  setMode: 'abaco:browser:setMode'
} as const

/** Main → chrome-bar push of the current navigation state. */
export const ABACO_BROWSER_CHROME_STATE_CHANNEL = 'abaco-browser-chrome:navigated'

export interface AbacoBrowserChromeState {
  url: string
  canGoBack: boolean
  canGoForward: boolean
  loading: boolean
  mode: AbacoBrowserMode
}

/** Result shape of every control channel except `isOpen`, which returns a boolean. */
export interface AbacoBrowserCommandResult {
  ok: boolean
}

/* ────────────────────────────────────────────────────────────────────────────
 * F1 — takeover mode
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Who owns the overlay right now.
 *
 * `agent` — the agent's `abaco_browser_*` tools may drive the page.
 * `manual` — the user has taken over (typing in the chrome bar, clicking
 * around): every agent action is refused with
 * {@link ABACO_BROWSER_TAKEOVER_MESSAGE} until ownership is handed back. The
 * point is not to lock the user out but to stop the agent from fighting the
 * human for the same cursor, which is the failure mode
 * `desktop/features/browser/takeover-controller.ts` guards against upstream.
 */
export type AbacoBrowserMode = 'agent' | 'manual'

/**
 * Ownership when the overlay opens. The agent owns it first because the tools
 * are the reason F1 exists; taking over is one click on the chrome bar's mode
 * button, and the state that follows is visible to both sides.
 */
export const ABACO_BROWSER_DEFAULT_MODE: AbacoBrowserMode = 'agent'

/**
 * Canonical refusal for an agent action attempted while the user holds the
 * overlay. The controller throws it, the RPC server returns it as a 409 body and
 * the tools surface it to the model unchanged, so one sentence explains the
 * same condition at every layer.
 */
export const ABACO_BROWSER_TAKEOVER_MESSAGE =
  'The ABACO browser is in manual mode: the user has taken control of the page, so agent browser actions are refused. Ask the user to hand control back (mode: agent) or try again later.'

/**
 * Canonical "nothing is mounted yet" refusal. Shared so the controller, the RPC
 * server and the tool half cannot describe the same condition three ways.
 */
export const ABACO_BROWSER_NOT_OPEN_MESSAGE = 'The ABACO browser overlay is not open.'

/** True for the only string the mode flag accepts. */
export function isAbacoBrowserMode(value: unknown): value is AbacoBrowserMode {
  return value === 'agent' || value === 'manual'
}

/* ────────────────────────────────────────────────────────────────────────────
 * F1 — agent-facing results (the loopback RPC wire contract)
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Everything `abaco_browser_state` reports. `mode` is part of it on purpose:
 * a refused action and a successful one then carry the same ownership fact, so
 * the model can tell "the page is still loading" from "the user has the wheel".
 */
export interface AbacoBrowserState {
  open: boolean
  mode: AbacoBrowserMode
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

/** One element the agent acted on, named well enough to be re-targeted. */
export interface AbacoBrowserElementRef {
  selector: string
  tag: string
  /** Visible text, whitespace-collapsed and truncated for transport. */
  text: string
}

export interface AbacoBrowserClickResult {
  element: AbacoBrowserElementRef
}

export interface AbacoBrowserTypingResult {
  element: AbacoBrowserElementRef
  /** Whether the value was written at all; false means the target rejected it. */
  wrote: boolean
  /** Whether `submit: true` was asked to press Enter. */
  submitted: boolean
}

export interface AbacoBrowserHeading {
  level: number
  text: string
}

export interface AbacoBrowserLink {
  text: string
  href: string
}

/**
 * The readable projection of the page. `text` is what the model actually reads;
 * headings and links are the cheap structure around it, so a page whose body
 * text is noise still yields a usable outline.
 */
export interface AbacoBrowserDomReading {
  url: string
  title: string
  text: string
  charCount: number
  truncated: boolean
  headings: AbacoBrowserHeading[]
  links: AbacoBrowserLink[]
}

export interface AbacoBrowserWaitResult {
  element: AbacoBrowserElementRef
  waitedMs: number
}

/**
 * The PNG itself, base64-encoded. The RPC transports bytes and nothing else;
 * where the file ends up is the tool half's decision, because only that half
 * knows which directory its own agent can read back.
 */
export interface AbacoBrowserScreenshot {
  mimeType: 'image/png'
  width: number
  height: number
  byteLength: number
  dataBase64: string
}

/* ────────────────────────────────────────────────────────────────────────────
 * F1 — loopback RPC seam
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Loopback interface of the control server. It must be a literal address, never
 * `0.0.0.0` or `localhost`: the control plane acts on a live page and is only
 * ever reached by the Harness child process on this machine.
 */
export const ABACO_BROWSER_CTRL_HOST = '127.0.0.1'

/** Environment variable carrying the control server's ephemeral port. */
export const ABACO_BROWSER_CTRL_PORT_ENV = 'ABACO_BROWSER_CTRL_PORT'

/** Environment variable carrying the per-launch bearer token. */
export const ABACO_BROWSER_CTRL_TOKEN_ENV = 'ABACO_BROWSER_CTRL_TOKEN'

/** Request bodies are tiny JSON payloads; anything larger is refused unread. */
export const ABACO_BROWSER_RPC_MAX_BODY_BYTES = 64 * 1024

/**
 * The RPC surface, one route per agent tool. `/state` is the only read-only
 * route and the only one the takeover gate lets through in manual mode: knowing
 * *why* an action was refused must never require an action.
 */
export const abacoBrowserRpcRoutes = [
  'navigate',
  'click',
  'type',
  'read-dom',
  'wait-for',
  'screenshot',
  'state'
] as const

export type AbacoBrowserRpcRoute = (typeof abacoBrowserRpcRoutes)[number]

/** Default page-reading budget, in characters, for one `read-dom` call. */
export const ABACO_BROWSER_READ_DOM_MAX_CHARS = 20000

/** Hard ceiling on a caller-supplied `maxChars`, whatever it asks for. */
export const ABACO_BROWSER_READ_DOM_MAX_CHARS_CEILING = 200000

/** How many headings one `read-dom` call returns before it stops listing them. */
export const ABACO_BROWSER_READ_DOM_MAX_HEADINGS = 60

/** How many links one `read-dom` call returns before it stops listing them. */
export const ABACO_BROWSER_READ_DOM_MAX_LINKS = 120

/** Default selector-wait budget, in milliseconds. */
export const ABACO_BROWSER_WAIT_FOR_TIMEOUT_MS = 10000

/** Hard ceiling on a caller-supplied `wait_for` timeout, in milliseconds. */
export const ABACO_BROWSER_WAIT_FOR_MAX_TIMEOUT_MS = 60000

/** Default click/type selector budget, in milliseconds. */
export const ABACO_BROWSER_ACTION_TIMEOUT_MS = 5000

/** Hard ceiling on a caller-supplied click/type timeout, in milliseconds. */
export const ABACO_BROWSER_ACTION_MAX_TIMEOUT_MS = 60000

/** Bound on how long an agent navigation waits for the page to stop loading. */
export const ABACO_BROWSER_NAVIGATE_SETTLE_MS = 10000

/**
 * Slack added to the Node-side race timer on top of the budget the page script
 * polices itself with. The page's own deadline can only fire while the renderer
 * is responsive, so the outer timer is what covers a wedged page; the slack
 * keeps it from firing first and reporting a timeout for a call that was about
 * to answer.
 */
export const ABACO_BROWSER_RPC_GRACE_MS = 2000

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
