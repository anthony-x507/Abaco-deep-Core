/**
 * Shared contract of the ABACO DEEP HARNES integrated browser (F0 + F1 + F2 + F3).
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
 *
 * F2 adds the user-action recorder. Its contract lives here too, because the
 * three pieces that must agree about a recorded action are in three different
 * realms: the *page* emits it (`abaco-browser-page-scripts.ts`, a string that
 * runs inside the browsed document), *main* decodes and redacts it
 * (`abaco-browser-recorder.ts`) and the *chrome bar* renders the recording
 * state (its own preload). The wire prefix, the action vocabulary and the
 * redaction rules are therefore one constant set rather than three restatements.
 *
 * F3 adds the far end of that pipeline: the recording, once finished, is
 * compiled into a `SKILL.md` under `$DSH_HOME/skills/<slug>/`, which the Harness
 * skill provider discovers on its own. What lives here is the channel, the
 * request/result pair the chrome strip and main agree on, and the two path
 * constants (the skills root and the file name) that must match what
 * `@deepseek-ai/dsh-skill-filesystem` scans for.
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
  /**
   * F2 normalizes this one literal to the kebab-case the whole family uses
   * (F1 shipped `abaco:browser:setMode`). Only the chrome bar invokes it, and
   * both halves ship in the same bundle, so there is no rolling-upgrade seam to
   * keep open — see {@link AbacoBrowserMode} for why the *agent* still has no
   * route to it.
   */
  setMode: 'abaco:browser:set-mode',
  /** F2 — user-action recording (the raw material of a skill). */
  recordStart: 'abaco:browser:record-start',
  recordStop: 'abaco:browser:record-stop',
  recordStatus: 'abaco:browser:record-status',
  /**
   * F2 — "the user pressed this accelerator", sent by the chrome strip for the
   * commands the controller owns (reload/close/back/forward). One channel with
   * the command as its argument rather than one channel per key: the command
   * vocabulary is {@link abacoBrowserShortcuts} and main turns it straight into
   * `runShortcut`, the same entry point `before-input-event` uses for keystrokes
   * typed into the page.
   */
  shortcut: 'abaco:browser:shortcut',
  /** F2 — the resolved Harness theme, reported by the surface that knows it. */
  themeReport: 'abaco:browser:theme-report',
  /**
   * F3 — compile the last user recording into a `SKILL.md` the Harness
   * discovers. IPC-only, for the same reason the three recording channels are:
   * a skill is the *record of a human demonstration*, so the agent must not be
   * able to mint one. The agent consumes the result — the file — through its
   * own skill catalog, not through a tool.
   */
  saveSkill: 'abaco:browser:save-skill'
} as const

/** Main → chrome-bar push of the current navigation state. */
export const ABACO_BROWSER_CHROME_STATE_CHANNEL = 'abaco-browser-chrome:navigated'

/**
 * Main → chrome-bar push of the resolved Harness theme. A dedicated channel
 * (rather than another field on the navigation state) because the two facts
 * change for unrelated reasons: the theme changes when the user flips the
 * Harness appearance, the navigation state on every page load.
 */
export const ABACO_BROWSER_THEME_CHANGED_CHANNEL = 'abaco:browser:theme-changed'

/**
 * Main → chrome-bar push asking the strip to put the caret in its address input.
 * `⌘L` typed while the *page* has focus arrives at the controller, which can
 * hand focus to the strip's `webContents` but cannot touch its DOM; this is the
 * message that finishes the job on the other side.
 */
export const ABACO_BROWSER_CHROME_FOCUS_ADDRESS_CHANNEL = 'abaco-browser-chrome:focus-address'

/**
 * Shortest gap between two state pushes to the chrome bar.
 *
 * A recording makes this matter: every keystroke is an action, so the action
 * counter in the strip would otherwise cost one IPC round trip and one style
 * recalculation per letter. 120 ms is below the threshold at which a counter
 * looks stale and far above a typing cadence.
 */
export const ABACO_BROWSER_CHROME_MIN_STATE_INTERVAL_MS = 120

/** Who the chrome bar should paint itself for. */
export type AbacoBrowserTheme = 'light' | 'dark'

/** True for the only two strings the theme channel accepts. */
export function isAbacoBrowserTheme(value: unknown): value is AbacoBrowserTheme {
  return value === 'light' || value === 'dark'
}

export interface AbacoBrowserChromeState {
  url: string
  /** Page title, shown next to the address. Empty while the page has none. */
  title: string
  canGoBack: boolean
  canGoForward: boolean
  loading: boolean
  mode: AbacoBrowserMode
  /** True while a user-action recording is running; the strip shows ⏺. */
  recording: boolean
  /** How many actions the running recording has captured so far. */
  recordingActions: number
  /**
   * F3 — a *saved* recording exists on disk, so the strip can offer 💾 "save as
   * skill". False while a recording is still running: a skill is compiled from a
   * finished session, never from the half-written one.
   */
  hasRecording: boolean
  /** Session id of that saved recording; empty when there is none. */
  lastRecordingId: string
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

/* ────────────────────────────────────────────────────────────────────────────
 * F2 — keyboard shortcuts
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The browser's own accelerators. They are deliberately *not* Electron menu
 * accelerators: the overlay only exists while it is open, so a global menu item
 * would have to be enabled and disabled around it, while these are matched at
 * the two surfaces that actually have focus — the chrome bar's document and the
 * browsed page's `before-input-event`.
 */
export type AbacoBrowserShortcut = 'focus-address' | 'reload' | 'close' | 'back' | 'forward'

/** The accelerator vocabulary, so a channel argument can be validated. */
export const abacoBrowserShortcuts = [
  'focus-address',
  'reload',
  'close',
  'back',
  'forward'
] as const

/** True for the only five strings `abaco:browser:shortcut` accepts. */
export function isAbacoBrowserShortcut(value: unknown): value is AbacoBrowserShortcut {
  return typeof value === 'string' && (abacoBrowserShortcuts as readonly string[]).includes(value)
}

/**
 * A keyboard event reduced to what the table below reads. The chrome bar fills
 * it from a DOM `KeyboardEvent`, main from Electron's `before-input-event`
 * `input` object, which is why the modifiers are plain booleans with the DOM
 * names.
 */
export interface AbacoBrowserShortcutInput {
  key: string
  meta?: boolean
  ctrl?: boolean
  alt?: boolean
  shift?: boolean
}

/**
 * Map a keystroke to a browser command, or `undefined` when it is not one.
 *
 * `⌘` and `Ctrl` are interchangeable (`primary`): on macOS the app is expected
 * to answer ⌘ and on Windows/Linux Ctrl, and accepting both everywhere costs
 * nothing while making the strip usable over a screen share or a remote session.
 * `Alt` disqualifies a match (Alt+← is the Windows back gesture, not this);
 * `Shift` does not, because ⌘⇧← still reads as "back" to every user who tries it.
 */
export function abacoBrowserShortcutFor(
  input: AbacoBrowserShortcutInput
): AbacoBrowserShortcut | undefined {
  if (input.meta !== true && input.ctrl !== true) return undefined
  if (input.alt === true) return undefined
  switch (input.key.toLowerCase()) {
    case 'l':
      return 'focus-address'
    case 'r':
      return 'reload'
    case 'w':
      return 'close'
    case 'arrowleft':
      return 'back'
    case 'arrowright':
      return 'forward'
    default:
      return undefined
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * F2 — user-action recording (the raw material of an F3 skill)
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Wire prefix of a recorded action.
 *
 * The page script emits each action as `console.log(PREFIX, JSON.stringify(a))`
 * and main consumes it from `webContents.on('console-message')`. A console
 * channel is used instead of `postMessage` or a custom preload bridge because
 * the browsed page is a *remote* document: it has no preload, no `ipcRenderer`
 * and no route back into the shell, and a hostile page cannot be trusted to
 * implement a bus we define. `console-message` is the one channel every page
 * already has.
 */
export const ABACO_BROWSER_RECORD_PREFIX = '__ABACO_REC__'

/**
 * What a redacted value is replaced with. A visible marker rather than an empty
 * string: F3 must be able to tell "the user left this field empty" from "this
 * field was a password and we refuse to remember it".
 */
export const ABACO_BROWSER_REDACTED_VALUE = '***REDACTED***'

/**
 * The recorded-action vocabulary. It mirrors `ActionType` in the upstream
 * feature sketch (`desktop/features/browser/types.ts`), because F3's skill
 * generator consumes the same names; `screenshot` and `wait` are produced by
 * main, never by the page.
 */
export const abacoBrowserRecordedActionTypes = [
  'click',
  'type',
  'navigate',
  'scroll',
  'screenshot',
  'wait'
] as const

export type AbacoBrowserRecordedActionType = (typeof abacoBrowserRecordedActionTypes)[number]

/** True for the only strings a recorded action's `action_type` may hold. */
export function isAbacoBrowserRecordedActionType(
  value: unknown
): value is AbacoBrowserRecordedActionType {
  return (
    typeof value === 'string' &&
    (abacoBrowserRecordedActionTypes as readonly string[]).includes(value)
  )
}

/** Ceiling on one recorded `text` value; a paste into a textarea is not a step. */
export const ABACO_BROWSER_RECORD_MAX_TEXT = 4000

/** Ceiling on one recorded `selector`, so a pathological path cannot bloat the file. */
export const ABACO_BROWSER_RECORD_MAX_SELECTOR = 500

/** Ceiling on one recorded `notes` string. */
export const ABACO_BROWSER_RECORD_MAX_NOTES = 300

/**
 * Ceiling on how many actions one recording holds. A recording is read back by
 * an agent, so a runaway page (an infinite scroll, a chatty `input` handler)
 * must not be able to grow a file without bound.
 */
export const ABACO_BROWSER_RECORD_MAX_ACTIONS = 5000

/**
 * How close two `type` events on the same field must be to collapse into one
 * action. `input` fires per keystroke and every one of them carries the field's
 * *whole* current value, so a word typed by hand would otherwise become one
 * recorded step per letter — useless as a skill. A pause longer than this reads
 * as "the user finished this field".
 */
export const ABACO_BROWSER_RECORD_TYPE_MERGE_MS = 1200

/**
 * How close a `will-navigate` intent and the `did-navigate` that fulfils it must
 * be to collapse into one recorded navigation. Both events describe one trip,
 * and the second one is the one that carries the destination's title.
 */
export const ABACO_BROWSER_RECORD_NAVIGATE_MERGE_MS = 5000

/** Two scroll events inside this window that did not move far are one action. */
export const ABACO_BROWSER_RECORD_SCROLL_MERGE_MS = 1000

/** Directory of the recordings, below the app's `userData`. */
export const ABACO_BROWSER_RECORDINGS_DIRNAME = 'abaco-browser/recordings'

/** Schema tag of the JSON written to `<timestamp>.json`. */
export const ABACO_BROWSER_RECORDING_SCHEMA = 'abaco-browser-recording/1'

/**
 * The form metadata of the element an action touched.
 *
 * It is part of the wire format — and not just a local variable inside the page
 * script — because main re-derives the redaction decision from it. Trusting only
 * the page's own "this was a password" flag would put the whole guarantee on the
 * one script whose input is a hostile document.
 */
export interface AbacoBrowserRecordedField {
  tag: string
  type: string
  name: string
  id: string
  autocomplete: string
}

/** One user action, as it lands in the recording. */
export interface AbacoBrowserRecordedAction {
  /** ISO-8601, from the page's clock (main uses its own for synthesised rows). */
  timestamp: string
  url: string
  action_type: AbacoBrowserRecordedActionType
  selector?: string
  text?: string
  notes?: string
  /** Set on `screenshot` rows, and on a `type` row whose value was masked. */
  screenshot_path?: string
  field?: AbacoBrowserRecordedField
  /** True when `text` replaced something sensitive. */
  redacted?: boolean
}

/** Where the two bookend screenshots of a recording were written. */
export interface AbacoBrowserRecordingScreenshots {
  initial?: string
  final?: string
}

/**
 * The JSON persisted as `<timestamp>.json`.
 *
 * The field names of `actions` and the session envelope follow the upstream
 * `RecordingSession`/`RecordedAction` shapes (`desktop/features/browser/
 * types.ts`) so F3's skill generator can be ported against the same data; the
 * extra keys are additive, and `schema` is what a reader should branch on.
 */
export interface AbacoBrowserRecordingDocument {
  schema: typeof ABACO_BROWSER_RECORDING_SCHEMA
  session_id: string
  started_at: string
  ended_at: string
  initial_url: string
  final_url: string
  title: string
  /** Ownership while recording: a recording is a human demonstration, so `manual`. */
  mode: AbacoBrowserMode
  actions: AbacoBrowserRecordedAction[]
  screenshots: AbacoBrowserRecordingScreenshots
  /** What the decoder dropped, so a short recording can be explained. */
  skipped: { malformedMessages: number; redactedValues: number; duplicateActions: number }
  source_path?: string
}

/** Live state of the recorder, as reported by `abaco:browser:record-status`. */
export interface AbacoBrowserRecordingStatus {
  recording: boolean
  /** Timestamp-derived id of the running (or last) session; empty when none. */
  sessionId: string
  /** ISO-8601 start of the running session; empty when none. */
  startedAt: string
  /** Actions captured so far, or by the last session. */
  actionCount: number
  /** ISO-8601 of the last captured action; empty when none. */
  lastActionAt: string
  /** Absolute path of the last recording written to disk; empty until one is. */
  lastRecordingPath: string
  /** Why the last screenshot or write failed; empty when nothing failed. */
  lastError: string
}

/** Result of `abaco:browser:record-stop`. */
export interface AbacoBrowserRecordingResult {
  ok: boolean
  /** The `<timestamp>.json` just written. */
  path: string
  sessionId: string
  actionCount: number
  durationMs: number
}

/**
 * Field names that make a value unrecordable, even when the control is not
 * `type="password"`. Everything here is matched against the *normalized* name,
 * id and `autocomplete` of the element — see {@link isSensitiveBrowserField}.
 */
export const ABACO_BROWSER_SENSITIVE_FIELD_TOKENS = [
  'pass',
  'password',
  'passwd',
  'pwd',
  'passphrase',
  'secret',
  'token',
  'apikey',
  'otp',
  'totp',
  'mfa',
  'pin',
  'cvv',
  'cvc',
  'csc',
  'ccv',
  'ccnum',
  'cardnumber',
  'creditcard',
  'iban',
  'ssn',
  'securitycode'
] as const

/** `autocomplete` values that name a credential or a payment secret. */
export const ABACO_BROWSER_SENSITIVE_AUTOCOMPLETE = [
  'current-password',
  'new-password',
  'one-time-code',
  'cc-number',
  'cc-csc',
  'cc-exp',
  'cc-exp-month',
  'cc-exp-year'
] as const

const sensitiveFieldTokens: ReadonlySet<string> = new Set(ABACO_BROWSER_SENSITIVE_FIELD_TOKENS)
const sensitiveAutocomplete: ReadonlySet<string> = new Set(ABACO_BROWSER_SENSITIVE_AUTOCOMPLETE)

/**
 * Fold a field name into `-`-separated lowercase words, so `user_password`,
 * `userPassword`, `user-password` and `user.password` all compare equal.
 *
 * The separator matters more than it looks: JavaScript's `\b` treats `_` as a
 * word character, so a `/\bpassword\b/` test misses `user_password` — the exact
 * spelling most forms use. Splitting on non-alphanumerics and comparing whole
 * segments has no such blind spot.
 */
export function normalizeBrowserFieldToken(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/gu, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
}

/**
 * Whether the value of this field must never be recorded.
 *
 * The bias is deliberate: a false positive costs one masked value the user can
 * still see on screen, a false negative writes a password into a JSON file that
 * an agent will read back. `type="password"` and the credential `autocomplete`
 * values are hard rules; the name/id token list is the heuristic that catches
 * the payment and login fields a site forgot to label properly.
 */
export function isSensitiveBrowserField(field: AbacoBrowserRecordedField | undefined): boolean {
  if (!field) return false
  if (field.type.trim().toLowerCase() === 'password') return true
  for (const raw of [field.autocomplete, field.name, field.id]) {
    const normalized = normalizeBrowserFieldToken(raw)
    if (normalized.length === 0) continue
    if (sensitiveAutocomplete.has(normalized)) return true
    if (sensitiveFieldTokens.has(normalized)) return true
    for (const segment of normalized.split('-')) {
      if (sensitiveFieldTokens.has(segment)) return true
      // Forms number their secret fields rather than renaming them: `cvv2` and
      // `cvc2` are as ordinary as `cvv`, and a trailing index must not be what
      // makes a card code recordable.
      const withoutIndex = segment.replace(/\d+$/u, '')
      if (withoutIndex !== segment && sensitiveFieldTokens.has(withoutIndex)) return true
    }
  }
  return false
}

/**
 * The redaction verdict for one recorded value. Three independent signals, any
 * of which is enough: the page's own flag, the element metadata main re-checks,
 * and a `password`/`redacted` marker in the notes.
 */
export function shouldRedactBrowserValue(input: {
  field?: AbacoBrowserRecordedField | undefined
  sensitive?: boolean | undefined
  notes?: string | undefined
}): boolean {
  if (input.sensitive === true) return true
  if (isSensitiveBrowserField(input.field)) return true
  return /password|passwd|redact/iu.test(input.notes ?? '')
}

/** Replace a value with {@link ABACO_BROWSER_REDACTED_VALUE} when it is sensitive. */
export function redactRecordedText(
  text: string,
  input: {
    field?: AbacoBrowserRecordedField | undefined
    sensitive?: boolean | undefined
    notes?: string | undefined
  }
): string {
  return shouldRedactBrowserValue(input) ? ABACO_BROWSER_REDACTED_VALUE : text
}

/* ────────────────────────────────────────────────────────────────────────────
 * F3 — a recording becomes a skill
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Directory of the generated skills, below `$DSH_HOME`.
 *
 * This is the *user-scope* skill root `@deepseek-ai/dsh-skill-filesystem`
 * discovers: for every directory directly under it, it looks for a `SKILL.md`
 * and parses that file's YAML frontmatter (`node_modules/@deepseek-ai/
 * dsh-skill-filesystem/lib/index.js:171-180`, `550-557`). Main already knows the
 * same root — it spawns the Harness child with `DSH_HOME=<userData>/harness`
 * (`src/main/runtime/harness-runtime.ts:271`) — so F3 writes beside the rest of
 * the user's skills rather than inventing a fourth location.
 */
export const ABACO_BROWSER_SKILLS_DIRNAME = 'skills'

/** File name the filesystem skill provider looks for inside a skill directory. */
export const ABACO_BROWSER_SKILL_FILENAME = 'SKILL.md'

/**
 * How many directories are tried when a slug is taken (`foo`, `foo-2`, …)
 * before the writer gives up on a name and falls back to one with the session's
 * own timestamp in it. A bound rather than an unbounded loop: 40 recordings of
 * the same page should not turn into 40 `stat` calls, and a name that long is a
 * symptom, not a goal.
 */
export const ABACO_BROWSER_SKILL_MAX_SUFFIX = 40

/**
 * Ceiling on how many numbered steps one generated skill holds. The recording
 * itself is capped at {@link ABACO_BROWSER_RECORD_MAX_ACTIONS}; this is the
 * second, tighter ceiling, because a hundred-step skill is no longer a
 * procedure an agent can follow. The overflow is reported in the skill's Notes.
 */
export const ABACO_BROWSER_SKILL_MAX_STEPS = 120

/** Ceiling on the `name` a caller may hand to `abaco:browser:save-skill`. */
export const ABACO_BROWSER_SKILL_MAX_NAME = 64

/** Ceiling on one inline value (a selector, a URL) printed inside a step. */
export const ABACO_BROWSER_SKILL_MAX_INLINE = 300

/**
 * How far the page must have moved between two recorded scrolls for the second
 * one to be a step rather than momentum. Below it, the scroll is dropped: a
 * recording of a single flick fires hundreds of scroll events, and only the
 * first position of each reading pause is a fact worth writing down.
 */
export const ABACO_BROWSER_SKILL_SCROLL_MIN_DELTA = 200

/**
 * Page-side selectors that will not survive a redesign. Every entry is a class
 * of generated name (styled-components, CSS modules, Emotion, a framework's
 * auto id, a UUID) rather than one site's markup, because the point is to warn
 * about *kinds* of fragility in the Notes section, not to list one recording's
 * bad selectors.
 */
export const ABACO_BROWSER_FRAGILE_SELECTOR_PATTERNS = [
  /:r[0-9a-z]{1,5}\\?:/iu,
  /(^|[^\w-])ember\d+/iu,
  /\.(css|sc|jsx)-[0-9a-z]{4,}/iu,
  /#[\w-]*\d{4,}/u,
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/iu,
  /\[(data-reactid|data-react-checksum|ng-reflect[\w-]*)\b/iu,
  /:nth-(child|of-type)\(/u,
  /\[(class|id)\*=/u
] as const

/**
 * True when a recorded selector is likely to break on the next deploy: too
 * deep, or built out of a generated name. Used for the "Notes" section, not to
 * reject a step — a fragile selector is still the only evidence the recording
 * holds about what the user clicked.
 */
export function isFragileBrowserSelector(selector: string): boolean {
  const value = selector.trim()
  if (value.length === 0) return false
  if (value.length > 80) return true
  // Deep descendant chains (`main > div > div > ul > li:nth-child(3) > a`) name
  // a position in today's DOM, not an element.
  if (value.split(/[>\s]+/u).filter((part) => part.length > 0).length > 5) return true
  return ABACO_BROWSER_FRAGILE_SELECTOR_PATTERNS.some((pattern) => pattern.test(value))
}

/**
 * What the chrome strip asks for on `abaco:browser:save-skill`.
 *
 * Both fields are optional: the 💾 button sends `{}` when the user did not type
 * a name, and an empty `recordingId` means "the most recent recording", which is
 * the only one the strip can be showing.
 */
export interface AbacoBrowserSaveSkillRequest {
  /** Session id (`<timestamp>` file stem), or empty/omitted for the newest one. */
  recordingId?: string
  /** Slug the user typed; the writer normalizes it. Omitted = derived from the page. */
  name?: string
}

/**
 * Result of `abaco:browser:save-skill`. A failure is a value rather than a
 * throw: the strip has one line of text to show and no stack to print.
 */
export interface AbacoBrowserSaveSkillResult {
  ok: boolean
  /** Skill slug written into the frontmatter and used as the directory name. */
  name: string
  /** Absolute path of the `SKILL.md`. Empty when nothing was written. */
  path: string
  /** Absolute path of the skill directory. Empty when nothing was written. */
  directory: string
  /** One-line summary of what the skill does, as the catalog will show it. */
  description: string
  /** How many numbered steps the body holds. */
  stepCount: number
  /** Why nothing was written; empty on success. */
  error: string
}
