import { ipcRenderer } from 'electron'
import {
  ABACO_BROWSER_CHROME_FOCUS_ADDRESS_CHANNEL,
  ABACO_BROWSER_CHROME_STATE_CHANNEL,
  ABACO_BROWSER_DEFAULT_MODE,
  ABACO_BROWSER_DEFAULT_PLACEMENT,
  ABACO_BROWSER_THEME_CHANGED_CHANNEL,
  abacoBrowserChannels,
  abacoBrowserShortcutFor,
  isAbacoBrowserMode,
  isAbacoBrowserPlacement,
  isAbacoBrowserTheme,
  type AbacoBrowserChromeState,
  type AbacoBrowserMode,
  type AbacoBrowserRecordingResult,
  type AbacoBrowserRecordingStatus,
  type AbacoBrowserSaveSkillResult,
  type AbacoBrowserScreenRecordingResult,
  type AbacoBrowserScreenRecordingStatus,
  type AbacoBrowserShortcut
} from '../shared/abaco-browser'

/**
 * Preload of the ABACO browser chrome bar (`abaco-browser-chrome.html`).
 *
 * Like `windows-menu.ts`, this view renders a fully inert document and does all
 * of its work here: it is the only script in the strip, so nothing in the strip
 * needs a `contextBridge` surface. Every control forwards to the same
 * `abaco:browser:*` channels the harness-page bridge (`window.dshAbacoBrowser`)
 * uses, which is why the main process can accept both senders with one guard —
 * the address bar cannot reach the overlay's page, only the controller can.
 *
 * F1 adds the mode button: the only way to hand the overlay between the user and
 * the agent. It lives in the strip rather than in the Harness page because the
 * user's decision has to be reachable exactly when the agent holds the page —
 * i.e. from the one view that is always painted above it.
 *
 * F2 adds the rest of the chrome: the page title and a loading spinner next to
 * the address, the ⏺ recorder with its live action count, the Harness theme
 * push, and the accelerator table. The accelerators are *shared* with main
 * (`abacoBrowserShortcutFor`): this document sees only the keystrokes that
 * happen while it has focus, and the controller answers the same table for the
 * ones typed into the page through `before-input-event`, so ⌘R cannot mean two
 * different things depending on where the caret is.
 *
 * F3 adds one control, 💾 *save as skill*, which appears only once a recording
 * has actually been written to disk. It is the last step of the F2 → F3 flow and
 * the only one the user has to ask for: recording captures a demonstration, and
 * compiling it into a `SKILL.md` is a deliberate act with a name attached.
 */
const CONTROL_IDS = {
  back: 'abaco-browser-back',
  forward: 'abaco-browser-forward',
  reload: 'abaco-browser-reload',
  close: 'abaco-browser-close',
  address: 'abaco-browser-address',
  addressForm: 'abaco-browser-address-form',
  mode: 'abaco-browser-mode',
  title: 'abaco-browser-title',
  spinner: 'abaco-browser-spinner',
  record: 'abaco-browser-record',
  recordCount: 'abaco-browser-record-count',
  screenRecord: 'abaco-browser-screen-record',
  skillForm: 'abaco-browser-skill-form',
  skillName: 'abaco-browser-skill-name',
  skillSave: 'abaco-browser-skill-save',
  skillStatus: 'abaco-browser-skill-status'
} as const

/** Button label and tooltip per ownership mode, so the strip always states the truth. */
const MODE_LABELS: Record<AbacoBrowserMode, { text: string; title: string }> = {
  agent: {
    text: 'AGENT',
    title: 'The agent may drive this page. Click to take over manually.'
  },
  manual: {
    text: 'MANUAL',
    title: 'You have taken over. Agent browser actions are refused. Click to hand control back.'
  }
}

function byId<T extends HTMLElement>(id: string): T | null {
  const node = document.getElementById(id)
  return node === null ? null : (node as T)
}

function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  return ipcRenderer.invoke(channel, ...args).catch((error: unknown) => {
    console.warn(`[abaco-browser] ${channel} failed`, error)
    return undefined
  })
}

/**
 * Main validates every field it sends, but this document still checks: a shape
 * change that reached the strip unchecked would paint `undefined` into the
 * address bar, and the strip must never show a state it cannot vouch for.
 */
function readChromeState(value: unknown): AbacoBrowserChromeState | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Partial<AbacoBrowserChromeState>
  if (typeof candidate.url !== 'string') return undefined
  return {
    url: candidate.url,
    title: typeof candidate.title === 'string' ? candidate.title : '',
    canGoBack: candidate.canGoBack === true,
    canGoForward: candidate.canGoForward === true,
    loading: candidate.loading === true,
    mode: isAbacoBrowserMode(candidate.mode) ? candidate.mode : ABACO_BROWSER_DEFAULT_MODE,
    recording: candidate.recording === true,
    recordingActions:
      typeof candidate.recordingActions === 'number' && Number.isFinite(candidate.recordingActions)
        ? candidate.recordingActions
        : 0,
    hasRecording: candidate.hasRecording === true,
    lastRecordingId:
      typeof candidate.lastRecordingId === 'string' ? candidate.lastRecordingId : '',
    screenRecording: candidate.screenRecording === true,
    placement: isAbacoBrowserPlacement(candidate.placement)
      ? candidate.placement
      : ABACO_BROWSER_DEFAULT_PLACEMENT
  }
}

function mountAbacoBrowserChrome(): void {
  const back = byId<HTMLButtonElement>(CONTROL_IDS.back)
  const forward = byId<HTMLButtonElement>(CONTROL_IDS.forward)
  const reload = byId<HTMLButtonElement>(CONTROL_IDS.reload)
  const close = byId<HTMLButtonElement>(CONTROL_IDS.close)
  const address = byId<HTMLInputElement>(CONTROL_IDS.address)
  const addressForm = byId<HTMLFormElement>(CONTROL_IDS.addressForm)
  const modeButton = byId<HTMLButtonElement>(CONTROL_IDS.mode)
  const title = byId<HTMLSpanElement>(CONTROL_IDS.title)
  const spinner = byId<HTMLSpanElement>(CONTROL_IDS.spinner)
  const recordButton = byId<HTMLButtonElement>(CONTROL_IDS.record)
  const recordCount = byId<HTMLSpanElement>(CONTROL_IDS.recordCount)
  const screenRecordButton = byId<HTMLButtonElement>(CONTROL_IDS.screenRecord)
  const skillForm = byId<HTMLFormElement>(CONTROL_IDS.skillForm)
  const skillName = byId<HTMLInputElement>(CONTROL_IDS.skillName)
  const skillSave = byId<HTMLButtonElement>(CONTROL_IDS.skillSave)
  const skillStatus = byId<HTMLSpanElement>(CONTROL_IDS.skillStatus)
  if (
    !back ||
    !forward ||
    !reload ||
    !close ||
    !address ||
    !addressForm ||
    !modeButton ||
    !title ||
    !spinner ||
    !recordButton ||
    !recordCount ||
    !screenRecordButton ||
    !skillForm ||
    !skillName ||
    !skillSave ||
    !skillStatus
  ) {
    return
  }

  // Lets the stylesheet give macOS the native window-button gutter *and* the
  // draggable strip (`-webkit-app-region: drag` is darwin-only here: Windows and
  // Linux keep a native frame); the preload is the only script in this document
  // and still exposes `platform`.
  document.body.dataset.platform = process.platform
  document.body.dataset.placement = ABACO_BROWSER_DEFAULT_PLACEMENT

  back.addEventListener('click', () => void invoke(abacoBrowserChannels.back))
  forward.addEventListener('click', () => void invoke(abacoBrowserChannels.forward))
  reload.addEventListener('click', () => void invoke(abacoBrowserChannels.reload))
  close.addEventListener('click', () => void invoke(abacoBrowserChannels.close))

  // Ownership is explicit and reversible rather than inferred: the user clicking
  // around the page is not treated as a takeover, because an inference like that
  // would silently strand a running agent. This button is the whole switch.
  let mode: AbacoBrowserMode = ABACO_BROWSER_DEFAULT_MODE
  const paintMode = (next: AbacoBrowserMode): void => {
    mode = next
    const label = MODE_LABELS[next]
    modeButton.textContent = label.text
    modeButton.title = label.title
    modeButton.dataset.mode = next
    modeButton.setAttribute('aria-pressed', next === 'manual' ? 'true' : 'false')
  }
  paintMode(mode)
  modeButton.addEventListener('click', () => {
    // Painted optimistically for latency, then corrected by the state push the
    // controller emits from `setBrowserMode` — which is why a refused or ignored
    // change can never leave the strip lying about who owns the page.
    paintMode(mode === 'agent' ? 'manual' : 'agent')
    void invoke(abacoBrowserChannels.setMode, mode)
  })

  /* ── F2 — the recorder button ──────────────────────────────────────────────
   * The button is a switch, and it never guesses: `pending` blocks a second
   * click while the start/stop round trip is in flight (starting injects the
   * page script and takes the opening screenshot; stopping writes the file and
   * the closing PNG), and the authoritative state always arrives afterwards on
   * the state push — including the recording the controller finishes by itself
   * when the browser is closed. */
  let recording = false
  const paintRecording = (active: boolean, count: number, tooltip?: string): void => {
    recording = active
    recordButton.classList.toggle('is-recording', active)
    recordButton.setAttribute('aria-pressed', active ? 'true' : 'false')
    recordButton.setAttribute(
      'aria-label',
      active ? 'Stop recording browser actions' : 'Record browser actions'
    )
    recordButton.title =
      tooltip ??
      (active
        ? `Recording your actions in this page (${count} captured). Click to stop and save.`
        : 'Record my actions in this page — the result becomes a reusable skill (F2 → F3)')
    recordCount.hidden = !active
    recordCount.textContent = active ? `${count}` : ''
  }
  paintRecording(false, 0)

  const toggleRecording = async (): Promise<void> => {
    recordButton.dataset.pending = 'true'
    try {
      if (recording) {
        const result = (await invoke(abacoBrowserChannels.recordStop)) as
          | AbacoBrowserRecordingResult
          | undefined
        if (result && result.ok) {
          paintRecording(false, 0, `Saved ${result.actionCount} action(s) to ${result.path}`)
        } else {
          paintRecording(false, 0, 'The recording could not be saved to disk.')
        }
      } else {
        const status = (await invoke(abacoBrowserChannels.recordStart)) as
          | AbacoBrowserRecordingStatus
          | undefined
        if (status?.recording === true) {
          paintRecording(true, status.actionCount)
        } else {
          // Main refuses to start on a closed overlay and reports its own
          // failures through `lastError`; either way the button must not be left
          // looking as if it had started something.
          paintRecording(
            false,
            0,
            status?.lastError && status.lastError.length > 0
              ? `Recording did not start: ${status.lastError}`
              : 'Recording did not start.'
          )
        }
      }
    } finally {
      delete recordButton.dataset.pending
    }
  }
  recordButton.addEventListener('click', () => {
    if (recordButton.dataset.pending === 'true') return
    void toggleRecording()
  })

  /* ── P1 — desktopCapturer screen recording ────────────────────────────────
   * Same switch pattern as F2, on a second button. Stopping is what notifies
   * the agent (main pushes `screen-recording-stopped` to the Harness page). */
  let screenRecording = false
  const paintScreenRecording = (active: boolean, tooltip?: string): void => {
    screenRecording = active
    screenRecordButton.classList.toggle('is-recording', active)
    screenRecordButton.setAttribute('aria-pressed', active ? 'true' : 'false')
    screenRecordButton.setAttribute(
      'aria-label',
      active ? 'Stop screen recording' : 'Record screen pixels'
    )
    screenRecordButton.title =
      tooltip ??
      (active
        ? 'Recording the ABACO window. Click to stop — the agent will be notified.'
        : 'Record the ABACO window (desktopCapturer). Stopping notifies the agent.')
  }
  paintScreenRecording(false)

  const toggleScreenRecording = async (): Promise<void> => {
    screenRecordButton.dataset.pending = 'true'
    try {
      if (screenRecording) {
        const result = (await invoke(abacoBrowserChannels.screenRecordStop)) as
          | AbacoBrowserScreenRecordingResult
          | undefined
        if (result && result.ok) {
          paintScreenRecording(false, result.notice || `Saved to ${result.path}`)
        } else {
          paintScreenRecording(false, 'The screen recording could not be saved.')
        }
      } else {
        const status = (await invoke(abacoBrowserChannels.screenRecordStart)) as
          | AbacoBrowserScreenRecordingStatus
          | undefined
        if (status?.recording === true) {
          paintScreenRecording(true)
        } else {
          paintScreenRecording(
            false,
            status?.lastError && status.lastError.length > 0
              ? `Screen recording did not start: ${status.lastError}`
              : 'Screen recording did not start.'
          )
        }
      }
    } finally {
      delete screenRecordButton.dataset.pending
    }
  }
  screenRecordButton.addEventListener('click', () => {
    if (screenRecordButton.dataset.pending === 'true') return
    void toggleScreenRecording()
  })

  /* ── F3 — the recording becomes a skill ────────────────────────────────────
   * The 💾 form is only on screen while a *finished* recording exists, which is
   * a fact only main knows: `hasRecording` is its answer to "is there a
   * `<stamp>.json` on disk", and it is deliberately false while a recording is
   * still running, so the strip can never compile a half-written session.
   *
   * The name is optional and the user's to set — it becomes the skill's `name`
   * in the catalog — and whatever they type is normalized by main, so a name
   * with accents or spaces becomes the slug the Harness requires. The outcome
   * is shown here rather than in a dialog: success is "which skill, and where",
   * failure is the writer's own sentence. */
  let lastRecordingId = ''
  let skillStatusTimer: ReturnType<typeof setTimeout> | undefined
  const say = (message: string, tone: 'info' | 'error', tooltip?: string): void => {
    skillStatus.textContent = message
    skillStatus.dataset.tone = tone
    skillStatus.title = tooltip ?? message
    skillStatus.hidden = message.length === 0
    if (skillStatusTimer !== undefined) clearTimeout(skillStatusTimer)
    if (message.length > 0) {
      // Long enough to read a path and copy it mentally, short enough that the
      // strip is not permanently carrying the last save.
      skillStatusTimer = setTimeout(() => {
        skillStatus.hidden = true
        skillStatus.textContent = ''
      }, 12000)
    }
  }
  const paintSkill = (available: boolean): void => {
    skillForm.hidden = !available
    if (available) return
    skillName.value = ''
    say('', 'info')
  }
  paintSkill(false)

  skillForm.addEventListener('submit', (event) => {
    event.preventDefault()
    if (skillSave.dataset.pending === 'true') return
    skillSave.dataset.pending = 'true'
    delete skillSave.dataset.result
    say('Saving…', 'info')
    void (async () => {
      try {
        const request = {
          ...(lastRecordingId.length > 0 ? { recordingId: lastRecordingId } : {}),
          ...(skillName.value.trim().length > 0 ? { name: skillName.value.trim() } : {})
        }
        const result = (await invoke(
          abacoBrowserChannels.saveSkill,
          request
        )) as AbacoBrowserSaveSkillResult | undefined
        if (result?.ok === true) {
          skillSave.dataset.result = 'ok'
          // The path is what the user needs to find the file; the CSS truncates
          // it in the strip and the tooltip carries it whole.
          say(
            `Saved skill "${result.name}" (${result.stepCount} steps) — ${result.path}`,
            'info',
            `${result.path}\n\n${result.description}`
          )
          skillName.value = ''
        } else {
          skillSave.dataset.result = 'error'
          say(
            result !== undefined && result.error.length > 0
              ? result.error
              : 'The skill could not be saved.',
            'error'
          )
        }
      } finally {
        delete skillSave.dataset.pending
      }
    })()
  })

  addressForm.addEventListener('submit', (event) => {
    event.preventDefault()
    const target = address.value.trim()
    if (target.length === 0) return
    // Main normalizes the address (https assumed, non-http schemes rejected) so
    // the typed text and the shipped policy never diverge.
    void invoke(abacoBrowserChannels.navigate, target)
  })

  const focusAddress = (): void => {
    address.focus()
    address.select()
  }
  address.addEventListener('focus', () => address.select())

  /* ── F2 — accelerators ─────────────────────────────────────────────────────
   * The same table main uses for the page view. Only the two commands that are
   * purely about this document are handled locally (focusing the address bar);
   * everything else is forwarded to the controller, so ⌘W closes the *browser*
   * even when the caret is in the strip, and there is exactly one implementation
   * of "what does ⌘R do". */
  const localCommands: Partial<Record<AbacoBrowserShortcut, () => void>> = {
    'focus-address': focusAddress
  }
  document.addEventListener('keydown', (event) => {
    const shortcut = abacoBrowserShortcutFor({
      key: event.key,
      meta: event.metaKey,
      ctrl: event.ctrlKey,
      alt: event.altKey,
      shift: event.shiftKey
    })
    if (!shortcut) return
    event.preventDefault()
    const local = localCommands[shortcut]
    if (local) {
      local()
      return
    }
    // Forwarded to the controller: the strip may not run page code, and the
    // same command arrives from main when ⌘L was typed into the page (`focus-
    // address` is the one command this document handles itself).
    void invoke(abacoBrowserChannels.shortcut, shortcut)
  })

  // Main asks the strip for the caret when ⌘L was typed into the *page*: focus
  // cannot be moved into another view's DOM from outside it.
  ipcRenderer.on(ABACO_BROWSER_CHROME_FOCUS_ADDRESS_CHANNEL, () => focusAddress())

  ipcRenderer.on(ABACO_BROWSER_THEME_CHANGED_CHANNEL, (_event, theme: unknown) => {
    if (!isAbacoBrowserTheme(theme)) return
    document.body.dataset.theme = theme
  })

  ipcRenderer.on(ABACO_BROWSER_CHROME_STATE_CHANNEL, (_event, state: unknown) => {
    const next = readChromeState(state)
    if (!next) return
    back.disabled = !next.canGoBack
    forward.disabled = !next.canGoForward
    // Never overwrite what the user is typing.
    if (document.activeElement !== address) address.value = next.url
    address.title = next.url
    spinner.hidden = !next.loading
    title.textContent = next.title
    title.title = next.title
    paintMode(next.mode)
    // A recording can start or stop without this button being pressed (it is
    // saved automatically when the browser closes), so the push is what keeps
    // the strip honest; the tooltip is only reset when nothing pending said
    // something more specific.
    if (next.recording || recording) paintRecording(next.recording, next.recordingActions)
    if (next.screenRecording || screenRecording) paintScreenRecording(next.screenRecording)
    document.body.dataset.placement = next.placement
    // Same reasoning for F3's 💾: the recording it compiles may have been
    // stopped by main (browser closed), so availability and the session id both
    // come from the push. A push never clears the name the user is typing —
    // `paintSkill(true)` leaves the form alone.
    if (next.lastRecordingId.length > 0) lastRecordingId = next.lastRecordingId
    paintSkill(next.hasRecording)
  })
}

/**
 * Every control in the strip goes through `abaco:browser:*`; this file adds no
 * channel of its own. See {@link CONTROL_IDS} and the module docstring for the
 * split between what is handled here (address focus, painting) and what the
 * controller owns (navigation, mode, recording, the rest of the accelerators).
 */

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', mountAbacoBrowserChrome, { once: true })
} else {
  mountAbacoBrowserChrome()
}
