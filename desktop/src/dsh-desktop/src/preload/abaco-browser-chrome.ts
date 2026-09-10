import { ipcRenderer } from 'electron'
import {
  ABACO_BROWSER_CHROME_STATE_CHANNEL,
  ABACO_BROWSER_DEFAULT_MODE,
  abacoBrowserChannels,
  isAbacoBrowserMode,
  type AbacoBrowserChromeState,
  type AbacoBrowserMode
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
 */
const CONTROL_IDS = {
  back: 'abaco-browser-back',
  forward: 'abaco-browser-forward',
  reload: 'abaco-browser-reload',
  close: 'abaco-browser-close',
  address: 'abaco-browser-address',
  addressForm: 'abaco-browser-address-form',
  mode: 'abaco-browser-mode'
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

function invoke(channel: string, ...args: unknown[]): void {
  void ipcRenderer.invoke(channel, ...args).catch((error: unknown) => {
    console.warn(`[abaco-browser] ${channel} failed`, error)
  })
}

function readChromeState(value: unknown): AbacoBrowserChromeState | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Partial<AbacoBrowserChromeState>
  if (typeof candidate.url !== 'string') return undefined
  return {
    url: candidate.url,
    canGoBack: candidate.canGoBack === true,
    canGoForward: candidate.canGoForward === true,
    loading: candidate.loading === true,
    mode: isAbacoBrowserMode(candidate.mode) ? candidate.mode : ABACO_BROWSER_DEFAULT_MODE
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
  if (!back || !forward || !reload || !close || !address || !addressForm || !modeButton) return

  // Lets the stylesheet give macOS the native window-button gutter; the preload
  // is the only script in this document and still exposes `platform`.
  document.body.dataset.platform = process.platform

  back.addEventListener('click', () => invoke(abacoBrowserChannels.back))
  forward.addEventListener('click', () => invoke(abacoBrowserChannels.forward))
  reload.addEventListener('click', () => invoke(abacoBrowserChannels.reload))
  close.addEventListener('click', () => invoke(abacoBrowserChannels.close))

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
    invoke(abacoBrowserChannels.setMode, mode)
  })

  addressForm.addEventListener('submit', (event) => {
    event.preventDefault()
    const target = address.value.trim()
    if (target.length === 0) return
    // Main normalizes the address (https assumed, non-http schemes rejected) so
    // the typed text and the shipped policy never diverge.
    invoke(abacoBrowserChannels.navigate, target)
  })
  // Chromium's own accelerator is unavailable in this child view, so the strip
  // offers the address-bar focus shortcut on both modifier layouts.
  document.addEventListener('keydown', (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'l') return
    event.preventDefault()
    address.focus()
    address.select()
  })
  address.addEventListener('focus', () => address.select())

  ipcRenderer.on(ABACO_BROWSER_CHROME_STATE_CHANNEL, (_event, state: unknown) => {
    const next = readChromeState(state)
    if (!next) return
    back.disabled = !next.canGoBack
    forward.disabled = !next.canGoForward
    reload.classList.toggle('is-loading', next.loading)
    // Never overwrite what the user is typing.
    if (document.activeElement !== address) address.value = next.url
    address.title = next.url
    paintMode(next.mode)
  })
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', mountAbacoBrowserChrome, { once: true })
} else {
  mountAbacoBrowserChrome()
}
