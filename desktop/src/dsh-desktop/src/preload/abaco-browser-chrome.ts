import { ipcRenderer } from 'electron'
import {
  ABACO_BROWSER_CHROME_STATE_CHANNEL,
  abacoBrowserChannels,
  type AbacoBrowserChromeState
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
 */
const CONTROL_IDS = {
  back: 'abaco-browser-back',
  forward: 'abaco-browser-forward',
  reload: 'abaco-browser-reload',
  close: 'abaco-browser-close',
  address: 'abaco-browser-address',
  addressForm: 'abaco-browser-address-form'
} as const

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
    loading: candidate.loading === true
  }
}

function mountAbacoBrowserChrome(): void {
  const back = byId<HTMLButtonElement>(CONTROL_IDS.back)
  const forward = byId<HTMLButtonElement>(CONTROL_IDS.forward)
  const reload = byId<HTMLButtonElement>(CONTROL_IDS.reload)
  const close = byId<HTMLButtonElement>(CONTROL_IDS.close)
  const address = byId<HTMLInputElement>(CONTROL_IDS.address)
  const addressForm = byId<HTMLFormElement>(CONTROL_IDS.addressForm)
  if (!back || !forward || !reload || !close || !address || !addressForm) return

  // Lets the stylesheet give macOS the native window-button gutter; the
  // preload is the only script in this document and still exposes `platform`.
  document.body.dataset.platform = process.platform

  back.addEventListener('click', () => invoke(abacoBrowserChannels.back))
  forward.addEventListener('click', () => invoke(abacoBrowserChannels.forward))
  reload.addEventListener('click', () => invoke(abacoBrowserChannels.reload))
  close.addEventListener('click', () => invoke(abacoBrowserChannels.close))

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
  })
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', mountAbacoBrowserChrome, { once: true })
} else {
  mountAbacoBrowserChrome()
}
