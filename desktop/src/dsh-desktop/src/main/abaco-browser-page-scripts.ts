/**
 * Page-side bodies of the ABACO browser's agent actions (F1) and of the
 * user-action recorder (F2).
 *
 * `AbacoBrowserController` drives the browsed page with
 * `webContents.executeJavaScript`, which takes *source text*, not a function.
 * Writing those bodies as ordinary TypeScript functions and serializing them
 * with `Function.prototype.toString()` keeps them under `tsc` (the DOM lib is
 * in `lib` by default for this target), so a typo in `querySelectorAll` or a
 * wrong `KeyboardEventInit` field fails `npm run typecheck` instead of failing
 * silently inside a remote page at runtime.
 *
 * The rule that makes the serialization sound — and the reason every function
 * below repeats its own helpers instead of sharing them — is that a page body
 * may reference **no enclosing scope**: `String(fn)` carries the body and
 * nothing else, so a free variable (a module-level constant, a helper, an
 * imported symbol) would be a `ReferenceError` in the page. Everything except
 * DOM/built-in globals therefore arrives as an argument.
 *
 * @module abaco-browser-page-scripts
 */

/** What every selector-driven body reports back: enough to re-target the node. */
export interface PageElementRef {
  selector: string
  tag: string
  text: string
}

/**
 * Resolve `selector`, polling until it appears or `timeoutMs` elapses.
 *
 * Every body needs this and none of them can import it, so the loop is
 * duplicated verbatim; keep the copies identical when changing one.
 * Throws (inside the page) for an invalid selector or an exhausted budget, so
 * the failure reaches the tool as a readable message.
 */
export function clickInPage(selector: string, timeoutMs: number): Promise<PageElementRef> {
  return (async () => {
    const deadline = Date.now() + timeoutMs
    const find = (): Element | null => {
      try {
        return document.querySelector(selector)
      } catch {
        throw new Error('Invalid CSS selector: ' + selector)
      }
    }
    let element = find()
    while (!element && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      element = find()
    }
    if (!element) {
      throw new Error('No element matched "' + selector + '" within ' + timeoutMs + ' ms.')
    }
    element.scrollIntoView({ block: 'center', inline: 'center' })
    const box = element.getBoundingClientRect()
    const target = element as HTMLElement
    // A real click is a sequence, not one event: frameworks that listen on
    // pointerdown (menus, drag handles, most design systems) never react to a
    // bare `.click()`, and vice versa. Dispatching the pointer/mouse pair and
    // then `.click()` covers both without double-firing a `click` handler.
    const init: MouseEventInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      button: 0,
      clientX: box.left + box.width / 2,
      clientY: box.top + box.height / 2
    }
    if (typeof target.focus === 'function') target.focus({ preventScroll: true })
    element.dispatchEvent(new PointerEvent('pointerdown', init))
    element.dispatchEvent(new MouseEvent('mousedown', init))
    element.dispatchEvent(new PointerEvent('pointerup', init))
    element.dispatchEvent(new MouseEvent('mouseup', init))
    if (typeof target.click === 'function') target.click()
    return {
      selector,
      tag: element.tagName.toLowerCase(),
      text: (target.innerText ?? element.textContent ?? '').replace(/[^\S\n]+/gu, ' ').trim().slice(0, 200)
    }
  })()
}

/**
 * Write `text` into the field at `selector` and, when `submit` is set, press
 * Enter (and submit the owning form when nothing consumed the keystroke).
 *
 * The value goes through the *prototype* setter rather than `element.value = …`
 * because React and Vue install their own `value` accessor on the instance;
 * assigning directly updates the DOM but leaves the framework's internal state
 * stale, so the next render wipes the text and the control's own submit action
 * sees an empty field.
 */
export function typeInPage(
  selector: string,
  text: string,
  submit: boolean,
  timeoutMs: number
): Promise<PageElementRef & { wrote: boolean }> {
  return (async () => {
    const deadline = Date.now() + timeoutMs
    const find = (): Element | null => {
      try {
        return document.querySelector(selector)
      } catch {
        throw new Error('Invalid CSS selector: ' + selector)
      }
    }
    let element = find()
    while (!element && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      element = find()
    }
    if (!element) {
      throw new Error('No element matched "' + selector + '" within ' + timeoutMs + ' ms.')
    }
    element.scrollIntoView({ block: 'center', inline: 'center' })
    const target = element as HTMLElement
    if (typeof target.focus === 'function') target.focus({ preventScroll: true })

    let wrote = false
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const prototype =
        element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value')
      if (descriptor && typeof descriptor.set === 'function') descriptor.set.call(element, text)
      else element.value = text
      wrote = true
    } else if (target.isContentEditable) {
      target.textContent = text
      wrote = true
    }
    if (wrote) {
      element.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
      element.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
    }

    if (submit && wrote) {
      const init: KeyboardEventInit = {
        key: 'Enter',
        code: 'Enter',
        bubbles: true,
        cancelable: true,
        composed: true
      }
      // `dispatchEvent` returns false when a listener called `preventDefault`,
      // which is exactly the signal that the page already handled the Enter
      // itself (an autocomplete list, an inline search) and must not also get a
      // form submission. Synthetic events are untrusted, so the browser's own
      // default action never runs and an unconsumed Enter has to be finished by
      // hand through `requestSubmit()`.
      const unconsumed = element.dispatchEvent(new KeyboardEvent('keydown', init))
      element.dispatchEvent(new KeyboardEvent('keypress', init))
      element.dispatchEvent(new KeyboardEvent('keyup', init))
      if (unconsumed) {
        const form =
          element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
            ? element.form
            : element.closest('form')
        if (form && typeof form.requestSubmit === 'function') {
          try {
            form.requestSubmit()
          } catch {
            // A form without a submitter or with an invalid control throws; the
            // Enter sequence above already gave the page its chance.
          }
        }
      }
    }

    return {
      selector,
      tag: element.tagName.toLowerCase(),
      text: (target.innerText ?? element.textContent ?? '').replace(/[^\S\n]+/gu, ' ').trim().slice(0, 200),
      wrote
    }
  })()
}

/** The readable projection of one loaded page. */
export interface PageDomReading {
  text: string
  charCount: number
  truncated: boolean
  headings: { level: number; text: string }[]
  links: { text: string; href: string }[]
}

/**
 * Read the page as text plus a cheap outline.
 *
 * `innerText` (not `textContent`) is the source: it honours `display: none`,
 * so a screen-reader-hidden menu or a collapsed accordion does not flood the
 * model with markup it cannot see, and it inserts line breaks at block
 * boundaries instead of gluing every cell of a table into one word.
 */
export function readDomInPage(
  maxChars: number,
  maxHeadings: number,
  maxLinks: number
): PageDomReading {
  const collapse = (value: string): string =>
    value
      .replace(/[^\S\n]+/gu, ' ')
      .replace(/[ \t]+\n/gu, '\n')
      .replace(/\n{3,}/gu, '\n\n')
      .trim()

  const body = document.body
  const full = collapse(body ? body.innerText : document.documentElement.textContent ?? '')
  const text = full.slice(0, maxChars)

  const headings: { level: number; text: string }[] = []
  const headingNodes = document.querySelectorAll('h1, h2, h3, h4, h5, h6')
  for (let index = 0; index < headingNodes.length && headings.length < maxHeadings; index += 1) {
    const node = headingNodes[index]
    if (!node) continue
    const label = collapse((node as HTMLElement).innerText ?? node.textContent ?? '')
    if (label.length === 0) continue
    headings.push({ level: Number(node.tagName.slice(1)), text: label.slice(0, 200) })
  }

  const links: { text: string; href: string }[] = []
  const linkNodes = document.querySelectorAll('a[href]')
  for (let index = 0; index < linkNodes.length && links.length < maxLinks; index += 1) {
    const node = linkNodes[index]
    if (!node) continue
    const label = collapse((node as HTMLElement).innerText ?? node.textContent ?? '')
    if (label.length === 0) continue
    links.push({ text: label.slice(0, 120), href: (node as HTMLAnchorElement).href })
  }

  return {
    text,
    charCount: full.length,
    truncated: full.length > text.length,
    headings,
    links
  }
}

/**
 * Wait until `selector` resolves. Presence is the contract, not visibility: a
 * page that renders its result into a collapsed container has still finished,
 * and a caller that needs visibility can read the returned element's text.
 */
export function waitForInPage(selector: string, timeoutMs: number): Promise<PageElementRef> {
  return (async () => {
    const deadline = Date.now() + timeoutMs
    const find = (): Element | null => {
      try {
        return document.querySelector(selector)
      } catch {
        throw new Error('Invalid CSS selector: ' + selector)
      }
    }
    let element = find()
    while (!element && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      element = find()
    }
    if (!element) {
      throw new Error('No element matched "' + selector + '" within ' + timeoutMs + ' ms.')
    }
    return {
      selector,
      tag: element.tagName.toLowerCase(),
      text: ((element as HTMLElement).innerText ?? element.textContent ?? '')
        .replace(/[^\S\n]+/gu, ' ')
        .trim()
        .slice(0, 200)
    }
  })()
}

/* ──────────────────────────────────────────────────────────────────────────────
 * F2 — the recorder's page half
 * ────────────────────────────────────────────────────────────────────────────── */

/**
 * The form metadata of the element an action touched.
 *
 * A type, not a value: it is erased before the body is serialized, so the page
 * script may name it even though it may reference no enclosing *binding*.
 */
export interface PageRecordedField {
  tag: string
  type: string
  name: string
  id: string
  autocomplete: string
}

/**
 * What the page hands the recorder. Every field is optional on the wire because
 * the decoder in `abaco-browser-recorder.ts` re-validates; this type describes
 * what a well-behaved page emits.
 */
export interface PageRecordedAction {
  ts: string
  url: string
  action_type: string
  selector?: string
  text?: string
  notes?: string
  field?: PageRecordedField
  sensitive?: boolean
}

/** Arguments of {@link installRecorderInPage}. */
export interface PageRecorderOptions {
  /** `ABACO_BROWSER_RECORD_PREFIX`; passed in, never referenced from module scope. */
  prefix: string
  /** Redaction token, so the page and main mask with the same literal. */
  redactedValue: string
  /** Ceiling on a recorded selector path. */
  maxSelector: number
  /** Minimum gap between two recorded scroll events. */
  scrollMergeMs: number
  /** Field-name tokens that make a value unrecordable. */
  sensitiveTokens: string[]
  /** `autocomplete` values that make a value unrecordable. */
  sensitiveAutocomplete: string[]
}

/**
 * Install the recording listeners in the browsed document and return whether
 * they were installed by *this* call.
 *
 * This is the emitter half of the F2 recorder — the half the upstream sketch
 * already had (`desktop/features/browser/recorder.ts:263-348`) and whose output
 * nothing consumed. It keeps that design's console channel
 * (`console.log(prefix, json)`) because the browsed page is a remote document
 * with no preload and no route back into the shell, but changes three things:
 *
 *  1. **Only trusted events are recorded.** `event.isTrusted` is false for every
 *     script-dispatched event, which is exactly what the agent's own
 *     `abaco_browser_click`/`_type` tools dispatch (and what the page's own
 *     scripts dispatch). Without this filter an agent action performed while a
 *     recording runs would be recorded as if the user had done it, and a page
 *     could fabricate user steps at will. `executeJavaScript` cannot forge a
 *     trusted event, so this is a real boundary, not a formality.
 *  2. **Sensitive values never leave the page.** The redaction decision is taken
 *     here, against the element's `type`, `autocomplete`, `name` and `id`, and
 *     the plaintext is replaced *before* it is serialized — main re-checks the
 *     same metadata (defence in depth), but the strongest guarantee is that a
 *     password is never put on the console channel at all.
 *  3. **Selectors are unique or positional.** An `#id` is used only when it
 *     really is unique, then `data-testid`/`name`/`aria-label`, then a
 *     `tag:nth-of-type` path — so F3 gets a selector it can replay instead of
 *     one that matches the first of forty `.btn` elements.
 *
 * Idempotent: a second call in the same document is a no-op returning `false`,
 * which is what keeps the controller's `dom-ready` re-injection harmless.
 */
export function installRecorderInPage(options: PageRecorderOptions): boolean {
  const host = window as unknown as { __abacoRecorder?: { uninstall: () => void } }
  if (host.__abacoRecorder) return false

  /** Values that must never travel: `input` types with no user-typed content. */
  const nonTextInputTypes = [
    'button',
    'checkbox',
    'color',
    'file',
    'hidden',
    'image',
    'radio',
    'range',
    'reset',
    'submit'
  ]

  const attributeOf = (element: Element, name: string): string => {
    const value = element.getAttribute(name)
    return value === null ? '' : value
  }

  const fieldOf = (element: Element): PageRecordedField => ({
    tag: element.tagName.toLowerCase(),
    type: attributeOf(element, 'type'),
    name: attributeOf(element, 'name'),
    id: element.id === undefined || element.id === null ? '' : element.id,
    autocomplete: attributeOf(element, 'autocomplete')
  })

  const normalizeToken = (value: string): string =>
    value
      .replace(/([a-z0-9])([A-Z])/gu, '$1-$2')
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-+|-+$/gu, '')

  const isSensitive = (field: PageRecordedField | undefined): boolean => {
    if (!field) return false
    if (field.type.trim().toLowerCase() === 'password') return true
    const candidates = [field.autocomplete, field.name, field.id]
    for (let index = 0; index < candidates.length; index += 1) {
      const normalized = normalizeToken(candidates[index] ?? '')
      if (normalized.length === 0) continue
      if (options.sensitiveAutocomplete.indexOf(normalized) >= 0) return true
      if (options.sensitiveTokens.indexOf(normalized) >= 0) return true
      const segments = normalized.split('-')
      for (let segment = 0; segment < segments.length; segment += 1) {
        const value = segments[segment] ?? ''
        if (options.sensitiveTokens.indexOf(value) >= 0) return true
        // `cvv2`, `cvc2`: forms number a secret field instead of renaming it.
        // Keep this rule identical to `isSensitiveBrowserField` in
        // `src/shared/abaco-browser.ts` — the two are the same policy, applied
        // once before the value is serialized and once after.
        const withoutIndex = value.replace(/\d+$/u, '')
        if (withoutIndex !== value && options.sensitiveTokens.indexOf(withoutIndex) >= 0) return true
      }
    }
    return false
  }

  const escapeIdentifier = (value: string): string => {
    const css = (window as unknown as { CSS?: { escape?: (input: string) => string } }).CSS
    if (css && typeof css.escape === 'function') return css.escape(value)
    return value.replace(/[^a-zA-Z0-9_-]/gu, '\\$&')
  }

  const escapeAttributeValue = (value: string): string => value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')

  const unique = (selector: string): boolean => {
    try {
      return document.querySelectorAll(selector).length === 1
    } catch {
      return false
    }
  }

  const tagOf = (element: Element): string => element.tagName.toLowerCase()

  const selectorFor = (element: Element): string => {
    try {
      if (element.id) {
        const byId = '#' + escapeIdentifier(element.id)
        if (unique(byId)) return byId
      }
      const attributes = ['data-testid', 'data-test-id', 'data-test', 'name', 'aria-label']
      for (let index = 0; index < attributes.length; index += 1) {
        const name = attributes[index] ?? ''
        const value = attributeOf(element, name)
        if (value.length === 0) continue
        const candidate = tagOf(element) + '[' + name + '="' + escapeAttributeValue(value) + '"]'
        if (unique(candidate)) return candidate
      }
      const anchor = element.getAttribute('href')
      if (tagOf(element) === 'a' && anchor !== null && anchor.length > 0) {
        const candidate = 'a[href="' + escapeAttributeValue(anchor) + '"]'
        if (unique(candidate)) return candidate
      }
      const parts: string[] = []
      let node: Element | null = element
      while (node && parts.length < 6) {
        const current: Element = node
        const tag = tagOf(current)
        if (tag === 'html' || tag === 'body') break
        const parent: Element | null = current.parentElement
        let step = tag
        if (parent) {
          const siblings = Array.from(parent.children).filter(
            (child) => child.tagName === current.tagName
          )
          if (siblings.length > 1) {
            step = tag + ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')'
          }
        }
        parts.unshift(step)
        const candidate = parts.join(' > ')
        if (unique(candidate)) return candidate
        node = parent
      }
      const fallback = parts.join(' > ')
      return fallback.length > 0 ? fallback : tagOf(element)
    } catch {
      return tagOf(element)
    }
  }

  const labelOf = (element: Element): string => {
    const target = element as HTMLElement
    const raw = target.innerText ?? element.textContent ?? ''
    return raw.replace(/[^\S\n]+/gu, ' ').trim().slice(0, 120)
  }

  const send = (payload: PageRecordedAction): void => {
    try {
      console.log(options.prefix, JSON.stringify(payload))
    } catch {
      // A value that cannot be serialized is a value that is not recorded;
      // swallowing keeps a hostile `toJSON` from breaking the page.
    }
  }

  const emit = (element: Element, payload: Omit<PageRecordedAction, 'ts' | 'url'>): void => {
    const field = fieldOf(element)
    send({
      ts: new Date().toISOString(),
      url: location.href,
      ...payload,
      selector: (payload.selector ?? '').slice(0, options.maxSelector),
      field
    })
  }

  const onClick = (event: Event): void => {
    if (event.isTrusted !== true) return
    const raw = event.target
    if (!(raw instanceof Element)) return
    // A click on a `<span>` inside a button is a click on the button.
    const target =
      raw.closest('a, button, [role="button"], input, select, textarea, label, summary') ?? raw
    if (target === document.documentElement || target === document.body) return
    const field = fieldOf(target)
    emit(target, {
      action_type: 'click',
      selector: selectorFor(target),
      text: labelOf(target),
      notes: field.type.length > 0 ? field.type : field.tag
    })
  }

  const onInput = (event: Event): void => {
    if (event.isTrusted !== true) return
    const target = event.target
    if (!(target instanceof Element)) return
    const tag = target.tagName.toLowerCase()
    const field = fieldOf(target)
    const isSelect = tag === 'select'
    // `change` only matters where there is no `input` event to speak of; a text
    // field's blur-time `change` would otherwise duplicate its last row.
    if (event.type === 'change' && !isSelect) return
    if (tag === 'input' && nonTextInputTypes.indexOf(field.type.toLowerCase()) >= 0) return
    if (tag !== 'input' && tag !== 'textarea' && tag !== 'select' && !(target as HTMLElement).isContentEditable) {
      return
    }
    const sensitive = isSensitive(field)
    const value =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
        ? target.value
        : ((target as HTMLElement).innerText ?? '')
    emit(target, {
      action_type: 'type',
      selector: selectorFor(target),
      text: sensitive ? options.redactedValue : value,
      notes: sensitive ? 'redacted:password' : field.type,
      sensitive
    })
  }

  const onSubmit = (event: Event): void => {
    if (event.isTrusted !== true) return
    const form = event.target
    if (!(form instanceof HTMLFormElement)) return
    emit(form, { action_type: 'click', selector: 'form', text: '', notes: 'form submit' })
  }

  let lastScrollY = -1
  let lastScrollAt = 0
  const onScroll = (): void => {
    const y = Math.round(window.scrollY)
    if (y === lastScrollY) return
    const now = Date.now()
    // Passive and unpollable: a fast flick fires hundreds of scroll events, and
    // one recorded step per pixel of momentum is not a step.
    if (now - lastScrollAt < options.scrollMergeMs && Math.abs(y - lastScrollY) < 400) return
    lastScrollY = y
    lastScrollAt = now
    try {
      console.log(
        options.prefix,
        JSON.stringify({
          ts: new Date().toISOString(),
          url: location.href,
          action_type: 'scroll',
          notes: 'y=' + y
        })
      )
    } catch {
      // as `send`
    }
  }

  document.addEventListener('click', onClick, true)
  document.addEventListener('input', onInput, true)
  document.addEventListener('change', onInput, true)
  document.addEventListener('submit', onSubmit, true)
  window.addEventListener('scroll', onScroll, { passive: true })

  host.__abacoRecorder = {
    uninstall: (): void => {
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('input', onInput, true)
      document.removeEventListener('change', onInput, true)
      document.removeEventListener('submit', onSubmit, true)
      window.removeEventListener('scroll', onScroll)
    }
  }
  return true
}

/**
 * Remove the recording listeners from the browsed document.
 *
 * Called when the user stops recording; returns `false` when this document had
 * no recorder (a page that navigated mid-recording installs a fresh one on its
 * next `dom-ready`, and the old document's listeners died with it).
 */
export function uninstallRecorderInPage(): boolean {
  const host = window as unknown as { __abacoRecorder?: { uninstall?: () => void } }
  const installed = host.__abacoRecorder
  if (!installed || typeof installed.uninstall !== 'function') return false
  try {
    installed.uninstall()
  } catch {
    // A page that already tore the listeners down is exactly the outcome wanted.
  }
  delete host.__abacoRecorder
  return true
}
