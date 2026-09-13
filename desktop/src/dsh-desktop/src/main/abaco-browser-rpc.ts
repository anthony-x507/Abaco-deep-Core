/**
 * Loopback control plane of the ABACO integrated browser (F1).
 *
 * ## Why this exists
 *
 * The agent's tools and the browser live in different processes. The tools run
 * in the Harness Node child (`packages/abaco-browser/index.js`), because that is
 * where `ctx.tools` is; the browsed page is a `WebContentsView` owned by the
 * Electron main process, because that is the only process that may create one.
 * F0 already bridged main → renderer (preload + `abaco:browser:*` IPC), but a
 * renderer bridge cannot reach a Node child.
 *
 * The seam is therefore an HTTP server on `127.0.0.1` with an OS-assigned
 * ephemeral port and a per-launch bearer token, following the precedent of
 * `mobile/lan-mobile-bridge.ts`: main binds the port, hands port + token to the
 * child through its environment (`runtime/harness-runtime.ts`), and the child's
 * tools POST to it. Nothing is written to disk, nothing is configured by hand,
 * and the port moves on every launch.
 *
 * ## Trust model
 *
 * The token is the only credential and it never leaves the two processes: it is
 * generated per launch, sent in an `Authorization: Bearer` header, compared with
 * `timingSafeEqual`, and never echoed in a response. Binding to the literal
 * `127.0.0.1` (never `0.0.0.0`, never `localhost`, which can resolve to a
 * wildcard bind) keeps the socket off the LAN, and the handler additionally
 * refuses any peer that is not loopback. A browser page cannot reach this port
 * usefully even if it guessed it: no token, no route.
 *
 * ## Shape
 *
 * One route per agent tool, all of them JSON in and JSON out, each delegating
 * straight to {@link AbacoBrowserControlTarget} — the controller. The server
 * owns transport, authentication and status codes; the controller owns the page.
 *
 * @module abaco-browser-rpc
 */

import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  ABACO_BROWSER_CTRL_HOST,
  ABACO_BROWSER_CTRL_PORT_ENV,
  ABACO_BROWSER_CTRL_TOKEN_ENV,
  ABACO_BROWSER_NOT_OPEN_MESSAGE,
  ABACO_BROWSER_RPC_MAX_BODY_BYTES,
  ABACO_BROWSER_TAKEOVER_MESSAGE,
  abacoBrowserRpcRoutes,
  type AbacoBrowserClickResult,
  type AbacoBrowserDomReading,
  type AbacoBrowserMode,
  type AbacoBrowserRpcRoute,
  type AbacoBrowserScreenshot,
  type AbacoBrowserScreenRecordingResult,
  type AbacoBrowserScreenRecordingStatus,
  type AbacoBrowserState,
  type AbacoBrowserTypingResult,
  type AbacoBrowserWaitResult
} from '../shared/abaco-browser'

/**
 * The controller surface the control plane drives, expressed structurally.
 *
 * Declaring it here rather than importing `AbacoBrowserController` keeps this
 * module — and therefore its tests — free of `electron`: the server is plain
 * Node, so `test/abaco-browser-rpc.test.ts` can start a real listener and talk
 * to it over a real socket without an Electron runtime in the picture.
 */
export interface AbacoBrowserControlTarget {
  isOpen(): boolean
  browserMode(): AbacoBrowserMode
  agentState(): AbacoBrowserState
  agentNavigate(url: string, timeoutMs?: number): Promise<AbacoBrowserState>
  agentClick(selector: string, timeoutMs?: number): Promise<AbacoBrowserClickResult>
  agentType(
    selector: string,
    text: string,
    options?: { submit?: boolean; timeoutMs?: number }
  ): Promise<AbacoBrowserTypingResult>
  agentReadDom(options?: { maxChars?: number }): Promise<AbacoBrowserDomReading>
  agentWaitFor(selector: string, timeoutMs?: number): Promise<AbacoBrowserWaitResult>
  agentScreenshot(): Promise<AbacoBrowserScreenshot>
  /** Same control plane as chrome `setMode('agent')`. */
  agentGrabControl(): AbacoBrowserState
  /** Same control plane as chrome `setMode('manual')`. */
  agentReleaseControl(): AbacoBrowserState
  agentScreenRecordStart(): Promise<AbacoBrowserScreenRecordingStatus>
  agentScreenRecordStop(): Promise<AbacoBrowserScreenRecordingResult>
}

export interface AbacoBrowserRpcOptions {
  /**
   * Resolve the controller of the current main window. A function, not an
   * instance, because the window (and with it the controller) is created,
   * destroyed and recreated while this server lives for the whole app run.
   */
  controller(): AbacoBrowserControlTarget | undefined
  /** Diagnostic sink; defaults to `console.warn`. */
  log?(message: string): void
}

/** Port and token a started server is listening with. */
export interface AbacoBrowserRpcHandle {
  port: number
  token: string
}

/** One HTTP-level refusal carrying the status code it must be reported with. */
class AbacoBrowserRpcError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

/** Routes that never touch the page and are therefore always allowed. */
const READ_ONLY_ROUTES: readonly AbacoBrowserRpcRoute[] = ['state']

/**
 * Ownership flips. They deliberately bypass the takeover gate: grabbing control
 * is how the agent leaves manual mode, so the gate that refuses clicks must not
 * also refuse the ask for the wheel. Same `setBrowserMode` the chrome bar uses.
 */
const MODE_CONTROL_ROUTES: readonly AbacoBrowserRpcRoute[] = ['grab-control', 'release-control']

/**
 * Screen recording. Allowed in manual mode too: the agent may record while the
 * user demonstrates. Still requires an open browser (see dispatch).
 */
const SCREEN_RECORD_ROUTES: readonly AbacoBrowserRpcRoute[] = [
  'screen-record-start',
  'screen-record-stop'
]

/** Routes that may mount the overlay themselves instead of requiring one. */
const SELF_MOUNTING_ROUTES: readonly AbacoBrowserRpcRoute[] = ['navigate']

function isRpcRoute(value: string): value is AbacoBrowserRpcRoute {
  return (abacoBrowserRpcRoutes as readonly string[]).includes(value)
}

/**
 * A mounted, authenticated control server.
 *
 * Lifecycle: `start()` before the Harness child is spawned (so `environment()`
 * has something to hand over), `stop()` when the app quits. Both are idempotent,
 * so a window teardown path and a quit path can both call `stop()`.
 */
export class AbacoBrowserRpcServer {
  private server: Server | undefined
  private port: number | undefined
  private token: string | undefined

  constructor(private readonly options: AbacoBrowserRpcOptions) {}

  /** True once the listener is accepting requests. */
  isRunning(): boolean {
    return this.server !== undefined
  }

  /**
   * Port + token, or `undefined` before `start()`.
   *
   * Public because tests assert the two facts the child would receive, and
   * because it is the honest answer to "is this seam live".
   */
  handle(): AbacoBrowserRpcHandle | undefined {
    if (this.port === undefined || this.token === undefined) return undefined
    return { port: this.port, token: this.token }
  }

  /**
   * The variables `runtime/harness-runtime.ts` merges into the Harness child's
   * environment. Empty before `start()`, which makes an unstarted server
   * degrade into a clear "browser not available" error in the tools instead of
   * into a connection attempt against a port that was never bound.
   */
  environment(): NodeJS.ProcessEnv {
    const handle = this.handle()
    if (!handle) return {}
    return {
      [ABACO_BROWSER_CTRL_PORT_ENV]: String(handle.port),
      [ABACO_BROWSER_CTRL_TOKEN_ENV]: handle.token
    }
  }

  /** Bind the ephemeral loopback port and mint this launch's token. */
  async start(): Promise<AbacoBrowserRpcHandle> {
    const existing = this.handle()
    if (this.server && existing) return existing

    const token = randomBytes(32).toString('base64url')
    const server = createServer((request, response) => {
      void this.handleRequest(request, response)
    })
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => reject(error)
      server.once('error', onError)
      // Port 0: the OS picks a free port. A fixed port would collide with a
      // second ABACO window and, worse, with anything else already listening.
      server.listen(0, ABACO_BROWSER_CTRL_HOST, () => {
        server.removeListener('error', onError)
        resolve()
      })
    })
    // After listen(), an error is a runtime event, not a startup failure; it
    // must be logged rather than thrown into an unhandled 'error' crash.
    server.on('error', (error: Error) => this.log(`control server error: ${error.message}`))

    this.server = server
    this.token = token
    this.port = (server.address() as AddressInfo).port
    this.log(`control server listening on ${ABACO_BROWSER_CTRL_HOST}:${this.port}`)
    return { port: this.port, token }
  }

  /** Close the listener and forget the token. Safe to call more than once. */
  async stop(): Promise<void> {
    const server = this.server
    this.server = undefined
    this.port = undefined
    this.token = undefined
    if (!server) return
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
      // `close()` only stops new connections; an idle keep-alive socket from
      // the Harness child would otherwise hold the callback open forever.
      server.closeAllConnections?.()
    })
  }

  private log(message: string): void {
    const sink = this.options.log
    if (sink) sink(message)
    else console.warn(`[abaco-browser-rpc] ${message}`)
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * HTTP surface
   * ────────────────────────────────────────────────────────────────────────── */

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader('cache-control', 'no-store')
    response.setHeader('content-type', 'application/json; charset=utf-8')
    response.setHeader('x-content-type-options', 'nosniff')
    try {
      if (request.method !== 'POST' && request.method !== 'GET') {
        throw new AbacoBrowserRpcError(405, 'The browser control plane accepts GET and POST only.')
      }
      if (!isLoopback(request.socket.remoteAddress)) {
        throw new AbacoBrowserRpcError(403, 'The browser control plane is reachable from this machine only.')
      }
      if (!this.authorized(request)) {
        throw new AbacoBrowserRpcError(401, 'The browser control plane requires a valid launch token.')
      }
      const route = (request.url ?? '/').split('?')[0]?.replace(/^\/+/u, '').replace(/\/+$/u, '') ?? ''
      if (route.length === 0) {
        throw new AbacoBrowserRpcError(404, `Unknown browser control route "". Known routes: ${abacoBrowserRpcRoutes.join(', ')}.`)
      }
      if (!isRpcRoute(route)) {
        throw new AbacoBrowserRpcError(404, `Unknown browser control route "${route}". Known routes: ${abacoBrowserRpcRoutes.join(', ')}.`)
      }
      // A read-only route may be asked with either verb (GET is what a human
      // debugging the seam will reach for); everything else must POST, so a
      // stray GET can never click a button.
      if (request.method === 'GET' && !READ_ONLY_ROUTES.includes(route)) {
        throw new AbacoBrowserRpcError(405, `Browser control route "${route}" accepts POST only.`)
      }
      const body = await this.readBody(request)
      const result = await this.dispatch(route, body)
      this.send(response, 200, { ok: true, result })
    } catch (error) {
      const status = error instanceof AbacoBrowserRpcError ? error.status : 500
      const message = error instanceof Error ? error.message : String(error)
      this.send(response, status, { ok: false, error: message })
    }
  }

  /**
   * Bearer check.
   *
   * `timingSafeEqual` needs equal lengths, so the length comparison happens
   * first and is itself a (harmless) leak: the token's length is fixed and
   * public. Comparing the whole header as bytes rather than parsing around the
   * separator keeps a malformed header from reaching the comparator at all.
   */
  private authorized(request: IncomingMessage): boolean {
    const expected = this.token
    if (!expected) return false
    const header = request.headers.authorization
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false
    const presented = Buffer.from(header.slice('Bearer '.length), 'utf8')
    const intended = Buffer.from(expected, 'utf8')
    return presented.length === intended.length && timingSafeEqual(presented, intended)
  }

  private async readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of request) {
      const buffer = chunk as Buffer
      size += buffer.byteLength
      if (size > ABACO_BROWSER_RPC_MAX_BODY_BYTES) {
        throw new AbacoBrowserRpcError(
          413,
          `The browser control request body exceeds ${ABACO_BROWSER_RPC_MAX_BODY_BYTES} bytes.`
        )
      }
      chunks.push(buffer)
    }
    if (size === 0) return {}
    let parsed: unknown
    try {
      parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      throw new AbacoBrowserRpcError(400, 'The browser control request body must be JSON.')
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new AbacoBrowserRpcError(400, 'The browser control request body must be a JSON object.')
    }
    return parsed as Record<string, unknown>
  }

  private send(response: ServerResponse, status: number, payload: unknown): void {
    if (response.writableEnded) return
    response.statusCode = status
    response.end(JSON.stringify(payload))
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * Route dispatch
   * ────────────────────────────────────────────────────────────────────────── */

  /**
   * Run one route against the live controller.
   *
   * The two pre-checks below are deliberately *here* as well as in the
   * controller: this is where they become status codes, and doing them before
   * the call is what keeps a refusal from ever reaching the page. The
   * controller keeps its own gate because it is the component that owns the
   * page, and a second caller must not be able to route around this one.
   */
  private async dispatch(route: AbacoBrowserRpcRoute, body: Record<string, unknown>): Promise<unknown> {
    const target = this.options.controller()
    if (!target) {
      throw new AbacoBrowserRpcError(
        503,
        'The ABACO DEEP HARNES window is not available, so the integrated browser cannot be driven.'
      )
    }
    // `state` stays open in manual mode so the model can learn *why* it is
    // being refused. `grab-control` / `release-control` also stay open: they
    // *are* the mode switch (same setter as the chrome bar).
    if (
      !READ_ONLY_ROUTES.includes(route) &&
      !MODE_CONTROL_ROUTES.includes(route) &&
      !SCREEN_RECORD_ROUTES.includes(route) &&
      target.browserMode() !== 'agent'
    ) {
      throw new AbacoBrowserRpcError(409, ABACO_BROWSER_TAKEOVER_MESSAGE)
    }
    if (
      !SELF_MOUNTING_ROUTES.includes(route) &&
      !MODE_CONTROL_ROUTES.includes(route) &&
      !READ_ONLY_ROUTES.includes(route) &&
      !target.isOpen()
    ) {
      throw new AbacoBrowserRpcError(503, ABACO_BROWSER_NOT_OPEN_MESSAGE)
    }

    switch (route) {
      case 'state':
        return target.agentState()
      case 'navigate':
        return target.agentNavigate(requireString(body, 'url'), optionalNumber(body, 'timeoutMs'))
      case 'click':
        return target.agentClick(requireString(body, 'selector'), optionalNumber(body, 'timeoutMs'))
      case 'type':
        return target.agentType(requireString(body, 'selector'), requireString(body, 'text', { allowEmpty: true }), {
          submit: optionalBoolean(body, 'submit'),
          timeoutMs: optionalNumber(body, 'timeoutMs')
        })
      case 'read-dom':
        return target.agentReadDom({ maxChars: optionalNumber(body, 'maxChars') })
      case 'wait-for':
        return target.agentWaitFor(requireString(body, 'selector'), optionalNumber(body, 'timeoutMs'))
      case 'screenshot':
        return target.agentScreenshot()
      case 'grab-control':
        return target.agentGrabControl()
      case 'release-control':
        return target.agentReleaseControl()
      case 'screen-record-start':
        return target.agentScreenRecordStart()
      case 'screen-record-stop':
        return target.agentScreenRecordStop()
      default:
        return assertNeverRoute(route)
    }
  }
}

/** Exhaustiveness guard: a new route must be handled, not silently ignored. */
function assertNeverRoute(route: never): never {
  throw new AbacoBrowserRpcError(501, `Browser control route "${String(route)}" is not implemented.`)
}

/** True for the loopback addresses a peer can present on a `127.0.0.1` socket. */
function isLoopback(address: string | undefined): boolean {
  if (address === undefined) return false
  const normalized = address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address
  return normalized === '127.0.0.1' || normalized === '::1' || normalized.startsWith('127.')
}

function requireString(
  body: Record<string, unknown>,
  key: string,
  options: { allowEmpty?: boolean } = {}
): string {
  const value = body[key]
  if (typeof value !== 'string' || (!options.allowEmpty && value.trim().length === 0)) {
    throw new AbacoBrowserRpcError(
      400,
      options.allowEmpty
        ? `The browser control request needs a string "${key}".`
        : `The browser control request needs a non-empty string "${key}".`
    )
  }
  return value
}

function optionalNumber(body: Record<string, unknown>, key: string): number | undefined {
  const value = body[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AbacoBrowserRpcError(400, `The browser control request field "${key}" must be a number.`)
  }
  return value
}

function optionalBoolean(body: Record<string, unknown>, key: string): boolean | undefined {
  const value = body[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'boolean') {
    throw new AbacoBrowserRpcError(400, `The browser control request field "${key}" must be a boolean.`)
  }
  return value
}
