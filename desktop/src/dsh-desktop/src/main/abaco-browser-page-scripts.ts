/**
 * Page-side bodies of the ABACO browser's agent actions (F1).
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
