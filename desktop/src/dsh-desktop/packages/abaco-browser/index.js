/**
 * Host half of the `abaco-browser` plugin: the agent's tools over the ABACO
 * DEEP HARNES integrated browser (F1).
 *
 * ## Where this code runs
 *
 * This half runs inside the Harness Node child process, because that is the
 * process that owns `ctx.tools`. The browsed page, however, is a
 * `WebContentsView` owned by the Electron main process — a Node child cannot
 * create one and cannot reach one. F0's bridge (`window.dshAbacoBrowser`) does
 * not help either: it is a renderer preload, and this is not a renderer.
 *
 * The seam is therefore the loopback control plane in
 * `src/main/abaco-browser-rpc.ts`: main binds an ephemeral `127.0.0.1` port with
 * a per-launch bearer token, `src/main/runtime/harness-runtime.ts` puts both in
 * this process's environment, and every tool below is one JSON POST to it. If
 * those two variables are absent — an older shell, a standalone harness, safe
 * mode — the tools still load and fail with an explanation instead of
 * disappearing from the model's tool list.
 *
 * ## Contract with the shell
 *
 * The two environment names and the route names are restated here rather than
 * imported, because this is a separate package resolved inside the Harness
 * profile and cannot import `src/shared/abaco-browser.ts`. `test/
 * abaco-browser.test.ts` asserts that the two copies still agree, so the
 * duplication cannot rot into a silent runtime 404.
 *
 * This half reads nothing from `ctx` except `tools` — the launcher affordance
 * in the sidebar footer is the client half's (`./client.js`).
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'

/** Cordis plugin name used by loader diagnostics. */
const name = 'abaco-browser'

/**
 * The one service this half needs. It deliberately does not inject
 * `systemPrompt`: the tools describe themselves, and injecting a service that is
 * never used is what the loader's inject check rejects (see the disabled-plugin
 * note in `build/dsh-desktop.patch.yml`).
 */
const inject = ['tools']

/* ────────────────────────────────────────────────────────────────────────────
 * Loopback control plane (mirrors src/shared/abaco-browser.ts)
 * ──────────────────────────────────────────────────────────────────────────── */

/** Ephemeral port of the desktop control plane. Mirrors `ABACO_BROWSER_CTRL_PORT_ENV`. */
const PORT_ENV = 'ABACO_BROWSER_CTRL_PORT'

/** Per-launch bearer token of the desktop control plane. Mirrors `ABACO_BROWSER_CTRL_TOKEN_ENV`. */
const TOKEN_ENV = 'ABACO_BROWSER_CTRL_TOKEN'

/** Loopback host of the control plane. Mirrors `ABACO_BROWSER_CTRL_HOST`. */
const CONTROL_HOST = '127.0.0.1'

/**
 * Cooperative budgets per tool. `wait_for` is the only one that legitimately
 * blocks for a long time, so it gets the largest; the rest only have to cover a
 * loopback round trip plus the controller's own bounded work. They are attached
 * as `ToolDefinition.timeoutMs` for `@deepseek-ai/dsh-tool-call-timeout-policy`
 * to enforce, and every call forwards `exec.signal`, so the abort is real.
 */
const TIMEOUTS = {
  navigate: 30_000,
  click: 30_000,
  type: 30_000,
  readDom: 30_000,
  screenshot: 30_000,
  waitFor: 90_000,
  state: 15_000
}

/** Default selector wait used when the model does not pass `timeoutMs`. */
const DEFAULT_WAIT_TIMEOUT_MS = 10_000

/** Refusal when the shell never handed over a control endpoint. */
const UNCONFIGURED_MESSAGE =
  'The ABACO integrated browser is not available in this session: the desktop shell did not provide its control endpoint (ABACO_BROWSER_CTRL_PORT / ABACO_BROWSER_CTRL_TOKEN). Launch the agent from the ABACO DEEP HARNES desktop app, or drive the browser from its own overlay.'

/**
 * Read the port + token the shell injected at spawn.
 *
 * Validated rather than trusted: a malformed variable must produce the clear
 * "not available" message, not a request to port `NaN`.
 */
function controlEndpoint() {
  const rawPort = process.env[PORT_ENV]
  const token = process.env[TOKEN_ENV]
  const port =
    typeof rawPort === 'string' && /^\d+$/u.test(rawPort) ? Number.parseInt(rawPort, 10) : Number.NaN
  if (
    typeof token !== 'string' ||
    token.length === 0 ||
    !Number.isInteger(port) ||
    port <= 0 ||
    port > 65535
  ) {
    return undefined
  }
  return { baseUrl: `http://${CONTROL_HOST}:${port}`, token }
}

/**
 * One authenticated POST to the control plane, unwrapping its JSON envelope.
 *
 * The server answers `{ ok: true, result }` or `{ ok: false, error }`, and the
 * error strings are the controller's own — the takeover refusal and the
 * "overlay is not open" refusal are the same sentences the F0 code paths use, so
 * the model reads one story whichever layer refused.
 */
async function callRoute(route, body, signal) {
  const endpoint = controlEndpoint()
  if (!endpoint) throw new Error(UNCONFIGURED_MESSAGE)
  let response
  try {
    response = await fetch(`${endpoint.baseUrl}/${route}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${endpoint.token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(body ?? {}),
      ...(signal ? { signal } : {})
    })
  } catch (error) {
    // A cancelled call is not an unreachable server: the timeout policy owns
    // that message, so it must not be rewritten here.
    if (error instanceof Error && error.name === 'AbortError') throw error
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`The ABACO browser control plane is unreachable at ${endpoint.baseUrl}: ${message}`)
  }
  const payload = await response.json().catch(() => undefined)
  if (!response.ok || payload === null || typeof payload !== 'object' || payload.ok !== true) {
    const detail =
      payload !== null && typeof payload === 'object' && typeof payload.error === 'string'
        ? payload.error
        : `The ABACO browser control plane answered HTTP ${response.status}.`
    throw new Error(detail)
  }
  return payload.result
}

/**
 * The page state after an action, so one tool call tells the model both what it
 * did and where the page ended up. `state` runs no page script and is gated by
 * nothing, so it is always safe to ask for — including in manual mode, where it
 * is the only thing that may be asked for.
 */
async function pageState(signal) {
  return await callRoute('state', {}, signal)
}

/** Merge a completed action's own payload with the page state that followed it. */
async function withState(action, signal) {
  const state = await pageState(signal)
  return { ...(action ?? {}), ...state }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Output schema fragments
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The page-state properties every state-bearing tool returns.
 *
 * Built fresh per call rather than shared as a constant: `defineTool` compiles
 * (and may freeze) the spec it is handed, and one shared sub-object aliased into
 * seven definitions is exactly the coupling that turns one tool's compile into
 * another's runtime surprise.
 */
function stateProperties() {
  return {
    open: { type: 'boolean', required: true, description: 'Whether the browser overlay is mounted.' },
    mode: {
      type: 'string',
      enum: ['agent', 'manual'],
      required: true,
      description: 'Who owns the page: "agent" (you) or "manual" (the user took over).'
    },
    url: { type: 'string', required: true, description: 'Current page URL.' },
    title: { type: 'string', required: true, description: 'Current page title.' },
    loading: { type: 'boolean', required: true, description: 'Whether the page is still loading.' },
    canGoBack: { type: 'boolean', required: true },
    canGoForward: { type: 'boolean', required: true }
  }
}

/** The element an action targeted, named well enough to target it again. */
function elementSchema(description) {
  return {
    type: 'object',
    required: true,
    description,
    additionalProperties: false,
    properties: {
      selector: { type: 'string', required: true, description: 'The selector that was used.' },
      tag: { type: 'string', required: true, description: 'Lowercase tag name of the matched element.' },
      text: { type: 'string', required: true, description: 'Visible text of the element, truncated.' }
    }
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Model-facing renderers
 * ──────────────────────────────────────────────────────────────────────────── */

function textBlock(text) {
  return [{ type: 'text', text }]
}

/** The lines describing where the page is, shared by every renderer below. */
function describeState(value) {
  const lines = [
    `${value.title.length > 0 ? value.title : '(untitled)'} — ${value.url.length > 0 ? value.url : '(no url)'}`
  ]
  if (value.loading) lines.push('The page is still loading.')
  if (value.mode === 'manual') lines.push('Browser mode: MANUAL — the user has taken control.')
  return lines
}

function renderNavigate(_args, value) {
  return textBlock([...describeState(value), 'Navigated the ABACO browser to that address.'].join('\n'))
}

function renderClick(_args, value) {
  return textBlock(
    [
      ...describeState(value),
      `Clicked <${value.element.tag}> "${value.element.text}" (${value.element.selector}).`
    ].join('\n')
  )
}

function renderType(_args, value) {
  const wrote = value.wrote ? 'Typed into' : 'Could NOT write into'
  const submit = value.submitted ? ' Pressed Enter afterwards.' : ''
  return textBlock(
    [...describeState(value), `${wrote} <${value.element.tag}> (${value.element.selector}).${submit}`].join(
      '\n'
    )
  )
}

function renderReadDom(_args, value) {
  const sections = [`${value.title.length > 0 ? value.title : '(untitled)'} — ${value.url}`, '', value.text]
  if (value.charCount > value.text.length) {
    sections.push('', `[truncated: ${value.text.length} of ${value.charCount} characters returned]`)
  }
  if (value.headings.length > 0) {
    sections.push(
      '',
      'Headings:',
      ...value.headings.map((heading) => `${'#'.repeat(heading.level)} ${heading.text}`)
    )
  }
  if (value.links.length > 0) {
    sections.push('', 'Links:', ...value.links.map((link) => `- ${link.text} -> ${link.href}`))
  }
  return textBlock(sections.join('\n'))
}

function renderWaitFor(_args, value) {
  return textBlock(
    [
      ...describeState(value),
      `"${value.element.selector}" appeared after ${value.waitedMs} ms as <${value.element.tag}> "${value.element.text}".`
    ].join('\n')
  )
}

function renderState(_args, value) {
  const lines = describeState(value)
  lines.push(
    `History: ${value.canGoBack ? 'back available' : 'no back'}, ${value.canGoForward ? 'forward available' : 'no forward'}.`
  )
  if (!value.open) lines.push('The browser overlay is closed; call abaco_browser_navigate to open it.')
  return textBlock(lines.join('\n'))
}

function renderScreenshot(_args, value) {
  const lines = [
    ...describeState(value),
    `Captured ${value.width}x${value.height} PNG (${value.byteLength} bytes).`
  ]
  lines.push(
    value.path
      ? `Saved to ${value.path} — read it with the read_image tool to see the page.`
      : 'The image could not be written to disk, so only its dimensions are reported.'
  )
  return textBlock(lines.join('\n'))
}

/* ────────────────────────────────────────────────────────────────────────────
 * Screenshot persistence
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Write captured PNG bytes inside the Harness home and return the path.
 *
 * The bytes never travel in the tool result: a page-sized PNG is hundreds of
 * kilobytes of base64, which would cost more context than the page is worth and
 * would still not be an image the model can see. A path can be handed to
 * `read_image`, which is the tool that already knows how to show one.
 *
 * `DSH_HOME` is set by the shell for every Harness child; the temp directory is
 * the fallback for a standalone launch. A failure here is reported as "not
 * saved" rather than thrown: the capture itself succeeded, and its dimensions
 * are still useful.
 */
async function persistScreenshot(dataBase64) {
  const home = process.env.DSH_HOME
  const root = typeof home === 'string' && home.length > 0 ? home : tmpdir()
  const directory = join(root, 'abaco-browser', 'screenshots')
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-')
  try {
    await mkdir(directory, { recursive: true })
    const path = join(directory, `abaco-browser-${stamp}.png`)
    await writeFile(path, Buffer.from(dataBase64, 'base64'))
    return path
  } catch {
    return undefined
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Tools
 * ──────────────────────────────────────────────────────────────────────────── */

/** Every action tool shares one description of the ownership rule. */
const MODE_NOTE =
  'Fails with a clear message while the browser is in manual mode (the user has taken over) — do not retry in a loop; ask the user to hand control back.'

/**
 * Register the seven browser tools.
 *
 * Registration goes through `ctx.tools.register`, whose disposers are
 * effect-scoped: a plugin reload unregisters the previous set, so there is
 * nothing to tear down by hand. Nothing else on `ctx` is read or written.
 */
function apply(ctx) {
  ctx.tools.register(
    defineTool({
      name: 'abaco_browser_navigate',
      description: `Open the ABACO integrated browser at a URL, or navigate the already-open one. Mounts the browser window when it is closed. Waits for the page to finish loading (bounded). Returns the resulting page state (url, title, loading, ownership mode). ${MODE_NOTE}`,
      parameters: {
        url: {
          type: 'string',
          required: true,
          description: 'Absolute http(s) URL. A bare host such as example.com is treated as https.'
        },
        timeoutMs: {
          type: 'integer',
          description: 'How long to wait for the page to stop loading, in milliseconds (default 10000).'
        }
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: stateProperties()
        },
        render: renderNavigate
      },
      timeoutMs: TIMEOUTS.navigate,
      async execute(args, exec) {
        const result = await callRoute('navigate', { url: args.url, timeoutMs: args.timeoutMs }, exec.signal)
        return {
          open: result.open === true,
          mode: result.mode,
          url: result.url,
          title: result.title,
          loading: result.loading === true,
          canGoBack: result.canGoBack === true,
          canGoForward: result.canGoForward === true
        }
      }
    })
  )

  ctx.tools.register(
    defineTool({
      name: 'abaco_browser_click',
      description: `Click an element in the ABACO integrated browser, waiting for it to appear first. Real pointer and mouse events are dispatched, so framework-driven controls react. Returns the element that was clicked plus the page state afterwards. ${MODE_NOTE}`,
      parameters: {
        selector: { type: 'string', required: true, description: 'CSS selector of the element to click.' },
        timeoutMs: {
          type: 'integer',
          description: 'How long to wait for the selector to appear, in milliseconds (default 5000).'
        }
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ...stateProperties(),
            element: elementSchema('The element that was clicked.')
          }
        },
        render: renderClick
      },
      timeoutMs: TIMEOUTS.click,
      async execute(args, exec) {
        const action = await callRoute(
          'click',
          { selector: args.selector, timeoutMs: args.timeoutMs },
          exec.signal
        )
        return await withState({ element: action.element }, exec.signal)
      }
    })
  )

  ctx.tools.register(
    defineTool({
      name: 'abaco_browser_type',
      description: `Type text into an input, textarea or contenteditable element in the ABACO integrated browser. The value is written through the field's own setter and input/change events are dispatched, so React and Vue controlled fields see it. Set submit to press Enter afterwards. Returns the field plus the page state. ${MODE_NOTE}`,
      parameters: {
        selector: { type: 'string', required: true, description: 'CSS selector of the field to type into.' },
        text: { type: 'string', required: true, description: 'Text to write. May be empty to clear the field.' },
        submit: {
          type: 'boolean',
          description:
            'Press Enter after typing, and submit the owning form when nothing consumed the keystroke.'
        },
        timeoutMs: {
          type: 'integer',
          description: 'How long to wait for the selector to appear, in milliseconds (default 5000).'
        }
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ...stateProperties(),
            element: elementSchema('The field that received the text.'),
            wrote: { type: 'boolean', required: true, description: 'Whether the value was actually written.' },
            submitted: { type: 'boolean', required: true, description: 'Whether Enter was pressed.' }
          }
        },
        render: renderType
      },
      timeoutMs: TIMEOUTS.type,
      async execute(args, exec) {
        const action = await callRoute(
          'type',
          {
            selector: args.selector,
            text: args.text,
            ...(args.submit === undefined ? {} : { submit: args.submit }),
            timeoutMs: args.timeoutMs
          },
          exec.signal
        )
        return await withState(
          { element: action.element, wrote: action.wrote === true, submitted: action.submitted === true },
          exec.signal
        )
      }
    })
  )

  ctx.tools.register(
    defineTool({
      name: 'abaco_browser_read_dom',
      description:
        'Read the current page of the ABACO integrated browser as visible text, plus its headings and links. Use it to see what a page actually says after navigating or clicking. Very long pages are truncated and the result says so.',
      parameters: {
        maxChars: {
          type: 'integer',
          description: 'Maximum characters of page text to return (default 20000, capped at 200000).'
        }
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            url: { type: 'string', required: true },
            title: { type: 'string', required: true },
            text: { type: 'string', required: true, description: 'Visible page text, whitespace-collapsed.' },
            charCount: {
              type: 'integer',
              required: true,
              description: 'Length of the full page text before truncation.'
            },
            truncated: { type: 'boolean', required: true },
            headings: {
              type: 'array',
              required: true,
              description: 'Document outline, in document order.',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  level: { type: 'integer', required: true, description: '1 for h1, 2 for h2, …' },
                  text: { type: 'string', required: true }
                }
              }
            },
            links: {
              type: 'array',
              required: true,
              description: 'Links with visible text, in document order.',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  text: { type: 'string', required: true },
                  href: { type: 'string', required: true, description: 'Absolute URL.' }
                }
              }
            }
          }
        },
        render: renderReadDom
      },
      timeoutMs: TIMEOUTS.readDom,
      async execute(args, exec) {
        const reading = await callRoute(
          'read-dom',
          args.maxChars === undefined ? {} : { maxChars: args.maxChars },
          exec.signal
        )
        return {
          url: reading.url,
          title: reading.title,
          text: reading.text,
          charCount: reading.charCount,
          truncated: reading.truncated === true,
          headings: reading.headings.map((heading) => ({ level: heading.level, text: heading.text })),
          links: reading.links.map((link) => ({ text: link.text, href: link.href }))
        }
      }
    })
  )

  ctx.tools.register(
    defineTool({
      name: 'abaco_browser_wait_for',
      description: `Wait until a CSS selector exists in the ABACO integrated browser page — use it after an action that triggers slow content. Resolves as soon as the element appears, and fails if it never does. Returns the element and how long it took. ${MODE_NOTE}`,
      parameters: {
        selector: { type: 'string', required: true, description: 'CSS selector to wait for.' },
        timeoutMs: {
          type: 'integer',
          description: `How long to wait before failing, in milliseconds (default ${DEFAULT_WAIT_TIMEOUT_MS}, capped at 60000).`
        }
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ...stateProperties(),
            element: elementSchema('The element that appeared.'),
            waitedMs: { type: 'integer', required: true, description: 'Time spent waiting, in milliseconds.' }
          }
        },
        render: renderWaitFor
      },
      timeoutMs: TIMEOUTS.waitFor,
      async execute(args, exec) {
        const action = await callRoute(
          'wait-for',
          { selector: args.selector, timeoutMs: args.timeoutMs },
          exec.signal
        )
        return await withState({ element: action.element, waitedMs: action.waitedMs }, exec.signal)
      }
    })
  )

  ctx.tools.register(
    defineTool({
      name: 'abaco_browser_state',
      description:
        'Report the state of the ABACO integrated browser without touching the page: current url and title, whether it is loading, whether back and forward are available, whether the overlay is open, and who owns it (agent or manual). This is the only browser tool that works while the browser is in manual mode.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: stateProperties()
        },
        render: renderState
      },
      timeoutMs: TIMEOUTS.state,
      isConcurrencySafe: () => true,
      async execute(_args, exec) {
        const state = await pageState(exec.signal)
        return {
          open: state.open === true,
          mode: state.mode,
          url: state.url,
          title: state.title,
          loading: state.loading === true,
          canGoBack: state.canGoBack === true,
          canGoForward: state.canGoForward === true
        }
      }
    })
  )

  ctx.tools.register(
    defineTool({
      name: 'abaco_browser_screenshot',
      description: `Capture the visible ABACO integrated browser page as a PNG and save it inside the Harness home. Returns the file path; read that path with the read_image tool to actually look at the page. ${MODE_NOTE}`,
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            url: { type: 'string', required: true },
            title: { type: 'string', required: true },
            mimeType: { type: 'string', required: true },
            width: { type: 'integer', required: true },
            height: { type: 'integer', required: true },
            byteLength: { type: 'integer', required: true, description: 'Size of the PNG in bytes.' },
            path: {
              type: 'string',
              description: 'Absolute path of the saved PNG; absent when it could not be written.'
            }
          }
        },
        render: renderScreenshot
      },
      timeoutMs: TIMEOUTS.screenshot,
      async execute(_args, exec) {
        const capture = await callRoute('screenshot', {}, exec.signal)
        const path = await persistScreenshot(capture.dataBase64)
        const state = await pageState(exec.signal)
        return {
          url: state.url,
          title: state.title,
          mimeType: capture.mimeType,
          width: capture.width,
          height: capture.height,
          byteLength: capture.byteLength,
          ...(path === undefined ? {} : { path })
        }
      }
    })
  )
}

export { apply, inject, name }
