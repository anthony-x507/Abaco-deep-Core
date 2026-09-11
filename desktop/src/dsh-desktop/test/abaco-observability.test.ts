import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it } from 'vitest'
import {
  apply,
  Config,
  createObservability,
  inject,
  name,
  ObservabilityLog,
  readPressure,
  readToolResult,
  resolveObservabilityConfig,
  invalidConfigError
} from '../packages/abaco-observability/index.js'
import { readComposedPolicy } from '../packages/abaco-observability/lib/policy.js'
import { guardRejectsNewline, serializeRecord } from '../packages/abaco-observability/lib/log.js'

/**
 * `abaco-observability` — Phase 0 telemetry.
 *
 * ## How these tests avoid the failure this project already had
 *
 * Two earlier agents shipped a plugin written against **imagined** APIs, with
 * tests whose doubles confirmed the imagination: 26/26 green, dead in
 * production, failing silently. So the rules here are the project's own
 * (`docs/HANDOFF-FASE5.md` §7.2):
 *
 * - **The contract is verified against the installed engine, not a double.**
 *   `describe('engine contract')` below reads the installed package files and
 *   asserts the exact event names, payload members and projection keys this
 *   plugin depends on. If the engine moves, those tests fail here rather than in
 *   the owner's app.
 * - **The session events are real.** `session.append` on a session that a real
 *   `SessionStore` entered is what actually drives the listener, through the
 *   engine's own `session/event` firehose — not a hand-rolled emitter.
 * - **Anything that must be substituted is substituted with the engine's own
 *   shape.** `tokenMeter` and `sessionProjections` are the two seams that carry
 *   *measurements*; they are stubbed with the exact shapes read out of
 *   `dsh-token-meter/lib/index.js`, and the keys those stubs provide are the
 *   same keys `describe('engine contract')` pins in the installed source.
 */

/* ──────────────────────────────────────────────────────────────────────────────
 * Fixtures
 * ────────────────────────────────────────────────────────────────────────────── */

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

/** A fresh directory, removed after the test. */
async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'abaco-observability-'))
  temporaryDirectories.push(directory)
  return directory
}

/** A logger that records everything, so "loud" can be asserted. */
function recordingLogger(): { lines: string[]; info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void } {
  const lines: string[] = []
  return {
    lines,
    info: (...args: unknown[]) => lines.push(`info: ${args.map(String).join(' ')}`),
    warn: (...args: unknown[]) => lines.push(`warn: ${args.map(String).join(' ')}`)
  }
}

/**
 * The ledger behind one `contextPressure` reading.
 *
 * The shape is `{ pressureTokens?, projectedTokens?, contextWindow? }`, read
 * from `dsh-token-meter/lib/index.js:405-409`. `sample()` moves it, which is how
 * a test can make `used_after` differ from `used_before` without pretending the
 * engine did something it did not.
 */
function pressureLedger(initial: { pressureTokens?: number; projectedTokens?: number; contextWindow?: number } = {}) {
  let value = { ...initial }
  return {
    sample(next: { pressureTokens?: number; projectedTokens?: number; contextWindow?: number }) {
      value = { ...value, ...next }
    },
    snapshot(_session: unknown, keys?: string[]) {
      const values: Record<string, unknown> = {}
      if (keys === undefined || keys.includes('contextPressure')) values.contextPressure = { ...value }
      return { asOfSeq: 0, values }
    },
    listen: () => () => {}
  }
}

/** A `tokenMeter` whose `measure(session).totalTokens` is settable. */
function tokenMeterWith(initial = 0) {
  let totalTokens = initial
  return {
    set(next: number) {
      totalTokens = next
    },
    measure(_session: unknown) {
      return { totalTokens }
    },
    register: () => () => {}
  }
}

/**
 * Mount the row exactly as the loader does, on a real Cordis context, and hand
 * back the seams a test needs to drive it.
 */
async function mount(options: {
  home: string
  ledger?: ReturnType<typeof pressureLedger>
  meter?: ReturnType<typeof tokenMeterWith>
  config?: Record<string, unknown>
  logger?: ReturnType<typeof recordingLogger>
}): Promise<{
  ctx: Context
  store: SessionStore
  session: import('@deepseek-ai/dsh-session').Session
  logPath: string
  logger: ReturnType<typeof recordingLogger>
  lines: () => Promise<Record<string, unknown>[]>
}> {
  const logger = options.logger ?? recordingLogger()
  const ledger = options.ledger ?? pressureLedger({ contextWindow: 1_000_000 })
  const meter = options.meter ?? tokenMeterWith(0)

  const ctx = new Context()
  // The order is the composed profile's order: the engine's own services exist
  // first (`sessions` comes from the `SessionStore` below, and
  // `dsh-base/cordis.patch.yml:138`/`:323` mount session-projection and
  // token-meter long before a leaf plugin row), and the plugin row is applied
  // last. Mounting the row first would leave `ctx.inject` waiting forever on a
  // service that never arrives — which is a real failure mode, not a test quirk.
  const store = new SessionStore(ctx)
  await mountRow(
    ctx,
    {
      tokenMeter: meter,
      sessionProjections: ledger,
      logger: engineLogger(logger)
    },
    { home: options.home, ...options.config }
  )

  const session = store.create('session-1')
  return {
    ctx,
    store,
    session,
    logPath: join(options.home, 'logs', 'abaco-context.jsonl'),
    logger,
    lines: async () => readRecords(join(options.home, 'logs', 'abaco-context.jsonl'))
  }
}

/** Read a JSONL file into records. A missing file is an empty list, not an error. */
async function readRecords(path: string): Promise<Record<string, unknown>[]> {
  let text
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const trimmed = text.endsWith('\n') ? text.slice(0, -1) : text
  if (trimmed.length === 0) return []
  return trimmed.split('\n').map((line, index) => {
    try {
      return JSON.parse(line) as Record<string, unknown>
    } catch {
      throw new Error(`line ${String(index + 1)} of ${path} is not valid JSON: ${JSON.stringify(line.slice(0, 120))}`)
    }
  })
}

/** The engine's own checkpoint body: a `user/message` with text blocks. */
function checkpointMessage(text: string): { content: { type: string; text: string }[] } {
  return { content: [{ type: 'text', text }] }
}

/**
 * Append the checkpoint `user/message` the way the engine appends it.
 *
 * `compaction-basic` writes it with a `surfaceOp: { op: 'replace', start, end }`
 * plus the `sourceEventSeqs` that justify the replacement
 * (`dsh-compaction-basic/lib/index.js:606-615`). The engine is strict about the
 * provenance: a replace whose `sourceEventSeqs` omits any shadowed surface node
 * is refused with
 * `surface replace: sourceEventSeqs must include every shadowed surface node`
 * (`dsh-session/lib/index.js:185-188`). Emitting the marker by hand with an
 * invented shape would be exactly the kind of double this project forbids, so
 * the real contract is honoured.
 */
function appendCheckpoint(
  session: { append: (type: string, data: unknown, options?: unknown) => unknown },
  text: string,
  start: number,
  end: number,
  sourceEventSeqs: number[]
): void {
  session.append('user/message', checkpointMessage(text), {
    surfaceOp: { op: 'replace', start, end },
    sourceEventSeqs
  })
}

/** The surface nodes of a real session, so a replace can name them exactly. */
function surfaceNodes(session: { surface: { nodes: readonly number[] } }): number[] {
  return [...session.surface.nodes]
}

/**
 * Give a real session a real conversation surface, so a compaction has something
 * legitimate to replace.
 *
 * The engine only accepts a `replace` over a contiguous run of *surface* nodes,
 * which is why a bare `compaction/start` on a fresh session cannot be followed
 * by a checkpoint. Seeding two ordinary turns is what makes the rest of these
 * tests exercise the engine's own validation rather than bypass it.
 *
 * @returns the surface node seqs, in order.
 */
function seedSurface(
  session: { append: (type: string, data: unknown, options?: unknown) => unknown },
  turns: number
): void {
  for (let turn = 1; turn <= turns; turn += 1) {
    session.append('turn/start', { turn })
    session.append('user/message', { content: [{ type: 'text', text: `pregunta ${String(turn)}` }] }, { surfaceOp: 'append' })
    session.append('step/start', { turn, step: 1 })
    session.append(
      'assistant/message',
      { content: [{ type: 'text', text: `respuesta ${String(turn)}` }] },
      { surfaceOp: 'append', sourceEventSeqs: [] }
    )
    session.append('step/end', { turn, step: 1 })
    session.append('turn/end', { turn, reason: { kind: 'completed' } })
  }
}

/** The three services, as the context the row reads them from. */
function serviceContext(services: Record<string, unknown>): Record<string, unknown> {
  return services
}

/**
 * A logger shaped like the engine's, recording every line.
 *
 * `ctx.logger` is not one of the row's declared services, so it is assigned
 * onto the context rather than provided — which is how the engine has it too.
 */
function engineLogger(logger: ReturnType<typeof recordingLogger>): Record<string, unknown> {
  return { info: logger.info, warn: logger.warn, debug: () => {}, error: () => {} }
}

/**
 * Provide a real Cordis context's three services and mount the row for real.
 *
 * The plugin body calls `ctx.inject(inject, cb)` and **returns its result**, so
 * driving the row faithfully means awaiting that same handle: verified against
 * `@deepseek-ai/cordis`, `inject` returns a thenable `Fiber` whose callback runs
 * once the declared services are published. That is what the loader relies on,
 * and awaiting it here means the plugin's own contract is what is exercised —
 * no internal state is reached into and no callback is invoked by hand.
 *
 * The context must be a real `Context`: an invented object without a working
 * `provide`/`inject` pair would confirm only that the test agrees with itself.
 */
async function mountRow(ctx: Context, services: Record<string, unknown>, config: Record<string, unknown>): Promise<void> {
  // `sessions` is deliberately NOT provided here: it is the service
  // `SessionStore` registers itself (`dsh-session/lib/index.js:1547` →
  // `super(ctx, "sessions")`), and providing it throws
  // `service "sessions" has been registered at <root>`. The caller creates the
  // store before mounting the row, exactly as the composed profile does.
  for (const service of ['tokenMeter', 'sessionProjections']) {
    Object.assign(ctx, { [service]: services[service] })
    ctx.provide(service, services[service])
  }
  Object.assign(ctx, { logger: services.logger })
  await (apply(ctx, config) as unknown as Promise<unknown>)
}

/* ──────────────────────────────────────────────────────────────────────────────
 * 1. Engine contract — the installed package is the only oracle
 * ────────────────────────────────────────────────────────────────────────────── */

describe('engine contract', () => {
  /**
   * The engine source, from the **ABACO bundle first**.
   *
   * There are three copies of the engine on this machine and a claim is only
   * usable when it names which one it came from:
   *
   * | Copy | Path | Authority |
   * |---|---|---|
   * | **ABACO bundle** | `/Applications/ABACO DEEP HARNES.app/…/@deepseek-ai` | **authoritative for runtime** |
   * | DeepSeek Desktop | `/Applications/DSH Desktop.app/…/@deepseek-ai` | another product |
   * | Build input (repo) | `desktop/src/dsh-desktop/node_modules/@deepseek-ai` | what the bundle is built from |
   *
   * This suite reads the ABACO bundle, because that is the code the product
   * executes — the whole point of pinning an engine contract is to catch the
   * engine moving. The repository copy is the fallback for a machine where the
   * app is not installed (CI), and the resolved root is recorded in each
   * assertion's failure message so a red test says which copy it read.
   *
   * At the time of writing every file asserted below was verified
   * **md5-identical across all three copies**, so the contract is pinned
   * whichever root is available.
   */
  const abacoBundle = '/Applications/ABACO DEEP HARNES.app/Contents/Resources/app/node_modules/@deepseek-ai'
  const repoCopy = join(process.cwd(), 'node_modules', '@deepseek-ai')
  const engineRoot = existsSync(join(abacoBundle, 'dsh-session')) ? abacoBundle : repoCopy

  const read = async (relative: string) => {
    try {
      return await readFile(join(engineRoot, relative), 'utf8')
    } catch (error) {
      throw new Error(`engine contract could not read ${relative} from ${engineRoot}: ${String(error)}`)
    }
  }

  it('cites line numbers that actually describe what they claim', async () => {
    // The earlier handoff lost hours to citations that had drifted — a line
    // number pointing at a comment instead of the row it named. So the citations
    // in this package are not prose: each one is checked against the engine, and
    // a drifted number fails here instead of misleading the next reader.
    //
    // The claim table lives in the test because that is where a wrong claim is
    // cheap to fix; the package's own comments stay readable.
    const claims: [string, string][] = [
      ['dsh-session/lib/index.js:1427-1435', 'callbackArgs = [this, event]'],
      ['dsh-session/lib/index.js:1661', 'emitCtx: this.ctx'],
      ['dsh-session/lib/index.js:1547', 'super(ctx, "sessions")'],
      ['dsh-session/lib/index.js:914-966', 'KNOWN_SESSION_EVENT_TYPES'],
      ['dsh-session/lib/index.js:1416-1422', 'const event = deepFreeze'],
      ['dsh-compaction-basic/lib/index.js:434-439', 'const lifecycle = {'],
      ['dsh-compaction-basic/lib/index.js:454', 'append("compaction/end", lifecycle)'],
      ['dsh-compaction-basic/lib/index.js:462-468', 'errorChain(error)'],
      ['dsh-compaction-basic/lib/index.js:592-602', 'append("compaction/summary"'],
      ['dsh-compaction-basic/lib/index.js:608-615', 'append("user/message", checkpointMessage'],
      ['dsh-compaction-basic/lib/index.js:805', 'CONTEXT_WINDOW_EXCEEDED_CODE'],
      ['dsh-compaction-basic/lib/index.js:883-888', 'resolveCompactSpec(policy'],
      ['dsh-compaction-basic/lib/index.js:796', 'ctx.on("agent/status"'],
      ['dsh-compaction-basic/lib/index.js:113', 'retainTokens ('],
      ['dsh-compaction-tool-result-pruner/lib/index.js:162-168', 'compaction/prune'],
      ['dsh-compaction-tool-result-pruner/lib/index.js:79-83', 'measureContent'],
      ['dsh-llm/lib/index.js:111', 'CONTEXT_WINDOW_EXCEEDED_CODE'],
      ['dsh-llm/lib/index.js:169', 'function errorChain'],
      ['dsh-token-meter/lib/index.js:591', 'super(ctx, "tokenMeter")'],
      ['dsh-token-meter/lib/index.js:405-409', 'projectedTokens'],
      ['dsh-session-projection/lib/index.js:142', 'snapshot(session, keys)'],
      ['dsh-session-projection/lib/index.js:378-399', 'cursorBefore(session.seq)'],
      ['dsh-agent-loop/lib/index.js:386-393', 'dispatch.emit("agent/status"'],
      ['dsh-agent-loop/lib/index.js:660-666', 'waterfall("agent/request-error"'],
      ['cordis/lib/index.js:392', 'listener.apply(this, args)'],
      ['cordis/lib/index.js:1139-1143', 'Invalid effect'],
      ['dsh-spill-policy/lib/index.js:81-83', 'function spillNotice'],
      ['dsh-scope/lib/index.js:235-236', 'ancestor'],
      ['dsh-scope/lib/index.js:321-331', 'scopeTarget']
    ]
    for (const [citation, expected] of claims) {
      const colon = citation.lastIndexOf(':')
      const relative = citation.slice(0, colon)
      const [from, to] = citation.slice(colon + 1).split('-').map(Number)
      const source = await read(relative)
      const block = source.split('\n').slice(from - 1, to ?? from).join('\n')
      expect(block, `${citation} should contain ${JSON.stringify(expected)} in ${engineRoot}`).toContain(expected)
    }
  })

  it('declares only event names the installed engine knows', async () => {
    // The event vocabulary is closed: `dsh-session` refuses to reopen a log
    // containing a type outside this set
    // (`dsh-session/lib/index.js:919-966`, `KNOWN_SESSION_EVENT_TYPES`). If a
    // name this row listened for were not in it, the row would be watching
    // nothing at all — the exact silent failure this phase exists to end.
    const known = await read('dsh-session/lib/index.js')
    const vocabulary = known.slice(known.indexOf('const KNOWN_SESSION_EVENT_TYPES'))
    for (const eventType of [
      'compaction/start',
      'compaction/summary',
      'compaction/end',
      'compaction/prune',
      'tool/call',
      'tool/result',
      'user/message',
      'turn/end'
    ]) {
      expect(vocabulary).toContain(`"${eventType}"`)
    }
  })

  it('finds the compaction lifecycle emitted with the payload members it reads', async () => {
    const compaction = await read('dsh-compaction-basic/lib/index.js')
    // start: `{ compactionId, sourceCommandId?, turn }`
    expect(compaction).toContain('session.append("compaction/start", lifecycle)')
    // end: the same lifecycle, plus `error` — and that `error` is a RENDERED
    // STRING via `errorChain`, which is why the trigger cannot be read off it.
    expect(compaction).toContain('session.append("compaction/end", lifecycle)')
    expect(compaction).toContain('error: errorChain(error)')
    const llm = await read('dsh-llm/lib/index.js')
    expect(llm).toContain('function errorChain(value)')
    // summary: the span, the price, the route and the provider usage.
    const summary = await read('dsh-compaction-basic/lib/index.js')
    for (const member of ['shadowedRange', 'shadowedSeqs', 'shadowedTokenCount', 'provider', 'model', 'usage']) {
      expect(summary).toContain(member)
    }
  })

  it('finds compaction/prune carrying the shadowed token price', async () => {
    const pruner = await read('dsh-compaction-tool-result-pruner/lib/index.js')
    expect(pruner).toContain('session.append("compaction/prune"')
    expect(pruner).toContain('shadowedTokenCount')
    // ...and the pruner prices text in CODE POINTS, which is the unit this row
    // uses when it measures a result for the spill/large signal.
    expect(pruner).toContain('Array.from(text).length')
  })

  it('finds the contextPressure projection with the keys it reads', async () => {
    const meter = await read('dsh-token-meter/lib/index.js')
    expect(meter).toContain('key: "contextPressure"')
    expect(meter).toContain('pressureTokens')
    expect(meter).toContain('projectedTokens')
    expect(meter).toContain('contextWindow')
    expect(meter).toContain('pressureFrom = (usage) => usage.inputTokens')
    // The registry exposes `snapshot(session, keys)`, which is what is called.
    const projection = await read('dsh-session-projection/lib/index.js')
    expect(projection).toContain('snapshot(session, keys)')
    // ...and it folds lazily to the session cursor, which is what makes a
    // synchronous read from inside a `session/event` listener correct.
    expect(projection).toContain('cursorBefore(session.seq)')
  })

  it('finds the three services it injects and the overflow code it matches', async () => {
    expect(await read('dsh-token-meter/lib/index.js')).toContain('super(ctx, "tokenMeter")')
    expect(await read('dsh-session-projection/lib/index.js')).toContain('super(ctx, "sessionProjections")')
    expect(await read('dsh-session/lib/index.js')).toContain('super(ctx, "sessions")')
    expect(await read('dsh-llm/lib/index.js')).toContain(`const CONTEXT_WINDOW_EXCEEDED_CODE = "CONTEXT_WINDOW_EXCEEDED"`)
    // The overflow branch is what makes the code meaningful to this row.
    expect(await read('dsh-compaction-basic/lib/index.js')).toContain('failure.code !== CONTEXT_WINDOW_EXCEEDED_CODE')
  })

  it('finds the spill notice the spill signal matches on', async () => {
    const policy = await read('dsh-spill-policy/lib/index.js')
    expect(policy).toContain('Full formatted result stored at:')
    expect(policy).toContain('describeOmitted(omitted, "bytes")')
    // The spill notice is composed by `spillNotice` and the branch that emits it
    // is the same one this row counts.
    expect(policy).toContain('function spillNotice(omitted, ref)')
  })

  it('finds the session/event firehose emitted with the session and the event', async () => {
    const session = await read('dsh-session/lib/index.js')
    expect(session).toContain('const callbackArgs = [this, event]')
    expect(session).toContain('"session/event",')
    // And it is bound to the entering context, which is why a root listener sees it.
    expect(session).toContain('emitCtx: this.ctx')
  })

  it('finds agent/status and agent/request-error with the payloads it reads', async () => {
    const loop = await read('dsh-agent-loop/lib/index.js')
    expect(loop).toContain('this.dispatch.emit("agent/status", { status })')
    expect(loop).toContain('this.dispatch.waterfall("agent/request-error"')
    // The request-error payload carries NO session identity, which is exactly
    // why `onRequestError` has a recency fallback and says so in `attribution`.
    const errorCall = loop.slice(loop.indexOf('this.dispatch.waterfall("agent/request-error"'))
    const payload = errorCall.slice(0, errorCall.indexOf('}, () =>'))
    expect(payload).not.toContain('agent:')
  })
})

/* ──────────────────────────────────────────────────────────────────────────────
 * 2. Cordis safety — the defects that cost this project its first plugin
 * ────────────────────────────────────────────────────────────────────────────── */

describe('cordis safety', () => {
  it('exports a synchronous apply that returns undefined', async () => {
    const home = await temporaryDirectory()
    // The assertion that would have caught the defect that sent the app to Safe
    // Mode: an `async` body returns a Promise, Cordis collects the body's return
    // value as an *effect*, and a Promise resolving to anything but a function
    // or `undefined` throws `TypeError: Invalid effect` — failing the plugin and
    // with it the whole tree (`cordis/lib/index.js:1139-1143`).
    expect(apply.constructor.name).toBe('Function')

    const injected: unknown[] = []
    // The context returns a *thenable fiber* from `inject` — verified against
    // the real `@deepseek-ai/cordis`, which is exactly why this assertion has
    // teeth: returning that fiber is the most natural way to get this wrong, and
    // a fiber is neither `undefined` nor a plain object, so only an exact check
    // catches it.
    const ctx = {
      inject: (...args: unknown[]) => {
        injected.push(args)
        return { then: () => {}, constructor: { name: 'Fiber' } }
      },
      logger: { info: () => {}, warn: () => {} }
    }
    const result = apply(ctx, { home })
    expect(result).toBeUndefined()
    // Not a thenable and not any other object: `undefined` is the only value
    // Cordis may collect from a plugin body.
    expect(result === null || typeof result !== 'object').toBe(true)
    expect(injected).toHaveLength(1)
    expect(injected[0]?.[0]).toEqual(['tokenMeter', 'sessionProjections', 'sessions'])
  })

  it('returns nothing from the inject callback', async () => {
    const home = await temporaryDirectory()
    let callbackResult: unknown = 'not-called'
    const ctx = {
      inject: (_services: string[], callback: (scoped: unknown) => unknown) => {
        callbackResult = callback({
          get: () => undefined,
          on: () => () => {},
          logger: { info: () => {}, warn: () => {} }
        })
        return undefined
      },
      logger: { info: () => {}, warn: () => {} }
    }
    apply(ctx, { home })
    // A callback that returned its promise would hand Cordis a non-disposer
    // effect — the same dead tree by a different door.
    expect(callbackResult).toBeUndefined()
  })

  it('declares exactly the services it reads, and registers none', () => {
    expect(name).toBe('abaco-observability')
    expect(inject).toEqual(['tokenMeter', 'sessionProjections', 'sessions'])
    // The plugin exports no `provide`: it must not claim a service name, because
    // registering a second service under a live name throws in Cordis.
    expect(Object.keys(Config)).not.toContain('provide')
  })

  it('never throws out of config resolution, however wrong the config is', () => {
    const hostile = [
      undefined,
      null,
      42,
      'a string',
      [],
      { enabled: 'yes', home: 17, logFile: '', maxInlineBytes: -1, maxSessionsTracked: 0, presetId: {} },
      { maxReadCallsPerSession: 1.5, maxAttemptsPerSession: 'many', recordPrune: 'no', asyncWrites: 'sure' },
      { home: '   ', logFile: null }
    ]
    for (const raw of hostile) {
      // A throw while resolving a row's config is FATAL in Cordis and fails the
      // WHOLE plugin tree, not just this row. Resolution must be total.
      expect(() => resolveObservabilityConfig(raw as never, { DSH_HOME: '/tmp/dsh-probe' })).not.toThrow()
      const resolved = resolveObservabilityConfig(raw as never, { DSH_HOME: '/tmp/dsh-probe' })
      expect(resolved.logPath).toBe('/tmp/dsh-probe/logs/abaco-context.jsonl')
      expect(typeof resolved.maxInlineBytes).toBe('number')
      expect(resolved.maxInlineBytes).toBeGreaterThanOrEqual(0)
    }
  })

  it('reports invalid config loudly instead of repairing it silently', () => {
    const logger = recordingLogger()
    const bad = { maxInlineBytes: -5, recordPrune: 'yes' }
    const resolved = resolveObservabilityConfig(bad as never, { DSH_HOME: '/tmp/dsh-probe' })
    expect(resolved.valid).toBe(false)
    expect(resolved.reasons.length).toBeGreaterThanOrEqual(2)
    const error = invalidConfigError(resolved)
    expect(error).toBeInstanceOf(Error)
    expect(String(error?.message)).toContain('maxInlineBytes')
    expect(invalidConfigError(resolveObservabilityConfig(undefined as never, { DSH_HOME: '/tmp/x' }))).toBeUndefined()

    const service = createObservability({ ctx: undefined, config: bad, logger })
    expect(service.issues.length).toBeGreaterThanOrEqual(2)
    expect(logger.lines.some((line) => line.startsWith('warn: abaco-observability: "maxInlineBytes"'))).toBe(true)
    service.close()
  })

  it('does nothing at all when disabled', async () => {
    const home = await temporaryDirectory()
    const before = await readRecords(join(home, 'logs', 'abaco-context.jsonl'))
    expect(before).toEqual([])
    const ctx = {
      inject: () => {
        throw new Error('inject must not run while the row is disabled')
      },
      logger: { info: () => {}, warn: () => {} }
    }
    expect(() => apply(ctx, { home, enabled: false })).not.toThrow()
    // Disabled means no directory, no file, and no listener.
    await expect(stat(join(home, 'logs'))).rejects.toThrow(/ENOENT/u)
  })
})

/* ──────────────────────────────────────────────────────────────────────────────
 * 3. Mounting on a real Cordis context
 * ────────────────────────────────────────────────────────────────────────────── */

describe('mounting', () => {
  it('mounts on a real cordis context and records a self_check line', async () => {
    const home = await temporaryDirectory()
    const { ctx, lines, logPath } = await mount({ home })
    const records = await lines()
    const selfCheck = records.filter((record) => record.event === 'self_check').at(-1)
    expect(selfCheck).toBeDefined()
    expect(selfCheck?.logPath).toBe(logPath)
    expect(selfCheck?.valid).toBe(true)
    // The row proves it parsed the composed policy document rather than guessing.
    expect(selfCheck?.composedPolicy).toMatchObject({ policySource: 'preset-file', presetId: 'abaco' })
  })

  it('produces one JSON line per compaction with every required field', async () => {
    const home = await temporaryDirectory()
    const ledger = pressureLedger({ pressureTokens: 900_000, projectedTokens: 905_000, contextWindow: 1_000_000 })
    const meter = tokenMeterWith(899_000)
    const { ctx, session, lines } = await mount({ home, ledger, meter })

    // Two real turns give the session a real conversation surface, so the next
    // three events are the engine's own compaction sequence and its own
    // validation applies to them.
    seedSurface(session, 2)
    const nodes = surfaceNodes(session)
    expect(nodes.length).toBeGreaterThanOrEqual(4)

    session.append('compaction/start', { compactionId: 'c1', turn: 3 })
    ledger.sample({ pressureTokens: 120_000, projectedTokens: 130_000 })
    meter.set(121_000)
    session.append('compaction/prune', {
      shadowedRange: { start: nodes[0], end: nodes[0] },
      shadowedSeqs: [nodes[0]],
      shadowedTokenCount: 4_000
    })
    session.append('compaction/summary', {
      compactionId: 'c1',
      summary: [{ type: 'text', text: 'checkpoint body' }],
      shadowedRange: { start: nodes[0], end: nodes[nodes.length - 1] },
      shadowedSeqs: nodes,
      shadowedTokenCount: 780_000,
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      maxTokens: 8192,
      usage: { inputTokens: 900_000, outputTokens: 3_000, cacheReadTokens: 5_000 }
    })
    appendCheckpoint(session, 'x'.repeat(8_000), nodes[0], nodes[nodes.length - 1], nodes)
    session.append('compaction/end', { compactionId: 'c1', turn: 3 })
    // The replacement really landed on the engine's own surface.
    expect(session.surface.replaceGeneration).toBeGreaterThan(0)

    const records = await lines()
    const end = records.find((record) => record.event === 'compaction_end')
    expect(end).toBeDefined()

    // The acceptance criterion's fields, each one present and from a real source.
    expect(end?.usedBefore).toBe(905_000)
    expect(end?.usedAfter).toBe(130_000)
    expect(end?.deltaTokens).toBe(130_000 - 905_000)
    expect(end?.measuredTokens).toBe(900_000)
    expect(end?.estimatedTokens).toBe(899_000)
    expect(end?.contextWindow).toBe(1_000_000)
    expect(end?.model).toBe('deepseek-v4-flash')
    expect(end?.provider).toBe('deepseek')
    expect(end?.summaryMaxTokens).toBe(8192)
    expect(end?.spanTokens).toBe(780_000)
    expect(end?.spanNodes).toBe(nodes.length)
    expect(end?.truncatedCount).toBe(1)
    expect(end?.truncatedTokens).toBe(4_000)
    expect(end?.checkpointChars).toBe(8_000)
    expect(end?.checkpointTokens).toBe(2_000)
    expect(end?.checkpointReported).toBe(true)
    expect(end?.compressionRatio).toBe(780_000 / 2_000)
    expect(end?.providerUsagePromptTokens).toBe(905_000)
    expect(end?.summaryOutputTokens).toBe(3_000)
    expect(end?.compactionsTotal).toBe(1)
    expect(end?.alerts).toEqual([])

    // A start line and a prune line exist too — one line per observed event.
    expect(records.some((record) => record.event === 'compaction_start')).toBe(true)
    expect(records.filter((record) => record.event === 'compaction_prune')).toHaveLength(1)

    // Every line is complete JSON on its own, which is what "one line per event"
    // has to mean for a reader that reads line by line.
    const text = await readFile(join(home, 'logs', 'abaco-context.jsonl'), 'utf8')
    expect(text.endsWith('\n')).toBe(true)
    for (const line of text.slice(0, -1).split('\n')) expect(() => JSON.parse(line)).not.toThrow()
  })

  it('alerts loudly when post-compaction used does not fall', async () => {
    const home = await temporaryDirectory()
    const ledger = pressureLedger({ pressureTokens: 900_000, projectedTokens: 905_000, contextWindow: 1_000_000 })
    const { ctx, session, lines } = await mount({ home, ledger, meter: tokenMeterWith(899_000) })

    seedSurface(session, 2)
    const nodes = surfaceNodes(session)
    session.append('compaction/start', { compactionId: 'flat', turn: 3 })
    // The failure this whole phase exists to make visible: the summary replaced
    // the span and occupancy went UP.
    ledger.sample({ pressureTokens: 910_000, projectedTokens: 940_000 })
    session.append('compaction/summary', {
      compactionId: 'flat',
      summary: [{ type: 'text', text: 'bigger' }],
      shadowedRange: { start: nodes[0], end: nodes[nodes.length - 1] },
      shadowedSeqs: nodes,
      shadowedTokenCount: 100,
      provider: 'deepseek',
      model: 'deepseek-v4-flash'
    })
    appendCheckpoint(session, 'y'.repeat(400), nodes[0], nodes[nodes.length - 1], nodes)
    session.append('compaction/end', { compactionId: 'flat', turn: 3 })

    const end = (await lines()).find((record) => record.event === 'compaction_end')
    expect(end?.alerts).toContain('used-not-reduced')
    expect(Number(end?.deltaTokens)).toBeGreaterThan(0)
  })

  it('alerts when the compaction itself failed', async () => {
    const home = await temporaryDirectory()
    const { ctx, session, lines } = await mount({ home })

    session.append('compaction/start', { compactionId: 'boom', turn: 1 })
    session.append('compaction/end', { compactionId: 'boom', turn: 1, error: 'SurfaceChangedError: the selected span changed' })

    const end = (await lines()).find((record) => record.event === 'compaction_end')
    expect(end?.alerts).toContain('compaction-failed')
    expect(end?.error).toBe('SurfaceChangedError: the selected span changed')
  })

  it('alerts when the composed policy leaves compaction disabled', async () => {
    const home = await temporaryDirectory()
    // A preset whose engine row exists but is switched off: the state §8.5 says
    // must never be silent.
    await mkdir(join(home, '.agent-presets', 'abaco'), { recursive: true })
    await writeFile(
      join(home, '.agent-presets', 'abaco', 'agent.cordis.yml'),
      ['rows:', '  - id: compaction-basic', "    name: '@deepseek-ai/dsh-compaction-basic'", '    config:', '      auto: false'].join('\n'),
      'utf8'
    )
    const { ctx, lines } = await mount({ home })
    const selfCheck = (await lines()).find((record) => record.event === 'self_check')
    expect(selfCheck?.alerts).toContain('compaction-disabled')
    expect(selfCheck?.composedPolicy).toMatchObject({ found: true, engineRowFound: true })
  })

  it('alerts when the profile has no compaction engine row at all', async () => {
    const home = await temporaryDirectory()
    await mkdir(join(home, '.agent-presets', 'abaco'), { recursive: true })
    await writeFile(join(home, '.agent-presets', 'abaco', 'agent.cordis.yml'), 'rows:\n  - id: something-else\n', 'utf8')
    const { ctx, lines } = await mount({ home })
    const selfCheck = (await lines()).find((record) => record.event === 'self_check')
    expect(selfCheck?.alerts).toContain('compaction-engine-absent')
  })

  it('alerts when compaction never ran although the context was under pressure', async () => {
    const home = await temporaryDirectory()
    const logger = recordingLogger()
    // A profile whose engine row is present and enabled, so the FILE-based
    // checks are all satisfied...
    await mkdir(join(home, '.agent-presets', 'abaco'), { recursive: true })
    await writeFile(
      join(home, '.agent-presets', 'abaco', 'agent.cordis.yml'),
      ['rows:', '  - id: compaction-basic', '    config:', '      thresholdRatio: 0.9', '      retainRatio: 0.12', '      auto: true'].join('\n'),
      'utf8'
    )
    const ledger = pressureLedger({ pressureTokens: 950_000, projectedTokens: 950_000, contextWindow: 1_000_000 })
    const ctx = new Context()
    await mountRow(ctx, { tokenMeter: tokenMeterWith(950_000), sessionProjections: ledger, logger: engineLogger(logger) }, { home })
    const service = createObservability({ ctx, config: { home }, logger })

    // ...and a real request that reported real prompt-side pressure, while the
    // counter says no compaction ever happened. That combination is the
    // observable form of "the engine is not compacting", which §8.5 requires to
    // be loud. It is derived from live numbers only — never from the file.
    service.onSessionEvent({ id: 'session-1' }, {
      type: 'tool/result',
      seq: 0,
      time: Date.now(),
      data: { message: { content: [{ name: 'bash', content: [{ type: 'text', text: 'ok' }] }] } }
    })
    service.selfCheck('session-1')

    const records = await readRecords(join(home, 'logs', 'abaco-context.jsonl'))
    const selfCheck = records.filter((record) => record.event === 'self_check').at(-1)
    expect(selfCheck?.lastPressureTokens).toBe(950_000)
    expect(selfCheck?.totals).toMatchObject({ compactions: 0 })
    expect(selfCheck?.alerts).toContain('no-compaction-under-pressure')
    // The file-based checks stayed clean, proving the alert came from the live
    // numbers rather than from the policy document.
    expect(selfCheck?.alerts).not.toContain('compaction-disabled')
    expect(selfCheck?.alerts).not.toContain('compaction-engine-absent')
    service.close()
  })

  it('drops the disabled-engine alert as soon as a compaction really happens', async () => {
    const home = await temporaryDirectory()
    const logger = recordingLogger()
    const ledger = pressureLedger({ pressureTokens: 950_000, projectedTokens: 950_000, contextWindow: 1_000_000 })
    const ctx = new Context()
    await mountRow(ctx, { tokenMeter: tokenMeterWith(950_000), sessionProjections: ledger, logger: engineLogger(logger) }, { home })
    const service = createObservability({ ctx, config: { home }, logger })

    // Same pressure, but this time the engine did compact: there is nothing
    // disabled to report, and a false alarm here would train the operator to
    // ignore the one alert that matters.
    service.onSessionEvent({ id: 'session-1' }, {
      type: 'compaction/start',
      seq: 0,
      time: Date.now(),
      data: { compactionId: 'c1', turn: 1 }
    })
    service.onSessionEvent({ id: 'session-1' }, {
      type: 'compaction/summary',
      seq: 1,
      time: Date.now(),
      data: {
        compactionId: 'c1',
        summary: [],
        shadowedRange: { start: 1, end: 1 },
        shadowedSeqs: [1],
        shadowedTokenCount: 10,
        provider: 'deepseek',
        model: 'm'
      }
    })
    service.onSessionEvent({ id: 'session-1' }, {
      type: 'user/message',
      seq: 2,
      time: Date.now(),
      data: checkpointMessage('body')
    })
    service.onSessionEvent({ id: 'session-1' }, {
      type: 'compaction/end',
      seq: 3,
      time: Date.now(),
      data: { compactionId: 'c1', turn: 1 }
    })
    service.selfCheck('session-1')

    const records = await readRecords(join(home, 'logs', 'abaco-context.jsonl'))
    const selfCheck = records.filter((record) => record.event === 'self_check').at(-1)
    expect(selfCheck?.totals).toMatchObject({ compactions: 1 })
    expect(selfCheck?.alerts).not.toContain('no-compaction-under-pressure')
    service.close()
  })
})

/* ──────────────────────────────────────────────────────────────────────────────
 * 4. The JSONL sink
 * ────────────────────────────────────────────────────────────────────────────── */

describe('jsonl sink', () => {
  it('appends without truncating, and every line stays whole', async () => {
    const home = await temporaryDirectory()
    const path = join(home, 'logs', 'abaco-context.jsonl')
    const logger = recordingLogger()
    const sink = new ObservabilityLog({ path, logger })

    for (let index = 0; index < 50; index += 1) {
      expect(sink.write({ event: 'probe', index, payload: `line ${String(index)}` })).toBe(true)
    }
    // Synchronous by default: everything is already on disk.
    expect(sink.idle).toBe(true)

    const records = await readRecords(path)
    expect(records).toHaveLength(50)
    expect(records.map((record) => record.index)).toEqual(Array.from({ length: 50 }, (_, index) => index))

    // Append, not rewrite: a second round must not disturb the first.
    for (let index = 0; index < 10; index += 1) sink.write({ event: 'probe', index: 100 + index })
    const after = await readRecords(path)
    expect(after).toHaveLength(60)
    expect(after[59]?.index).toBe(109)
    sink.close()
  })

  it('keeps concurrent writers from corrupting each other', async () => {
    const home = await temporaryDirectory()
    const path = join(home, 'logs', 'abaco-context.jsonl')
    const logger = recordingLogger()
    const sink = new ObservabilityLog({ path, logger })

    // Interleaved producers, each writing a distinguishable record. Order is not
    // promised; wholeness is, and that is what a JSONL reader needs.
    await Promise.all(
      Array.from({ length: 12 }, async (_unused, writer) => {
        for (let index = 0; index < 20; index += 1) {
          sink.write({ event: 'probe', writer, index, filler: 'f'.repeat(200) })
          if (index % 5 === 0) await Promise.resolve()
        }
      })
    )
    await sink.flush()
    const records = await readRecords(path)
    expect(records).toHaveLength(240)
    const seen = new Set(records.map((record) => `${String(record.writer)}:${String(record.index)}`))
    expect(seen.size).toBe(240)
    sink.close()
  })

  it('never truncates an existing file, even across a reopen', async () => {
    const home = await temporaryDirectory()
    const path = join(home, 'logs', 'abaco-context.jsonl')
    // A previous run's line, written by an earlier process.
    await mkdir(join(home, 'logs'), { recursive: true })
    await writeFile(path, '{"event":"from-a-previous-run"}\n', 'utf8')

    const first = new ObservabilityLog({ path, logger: recordingLogger() })
    first.write({ event: 'first' })
    first.close()

    // A second sink, as a restarted harness would open it. `w` instead of `a`
    // here would silently destroy the earlier evidence, which is the whole
    // failure this test exists to make impossible.
    const second = new ObservabilityLog({ path, logger: recordingLogger() })
    second.write({ event: 'second' })
    second.close()

    const records = await readRecords(path)
    expect(records.map((record) => record.event)).toEqual(['from-a-previous-run', 'first', 'second'])
  })

  it('refuses to emit a record that would break the line contract', async () => {
    const home = await temporaryDirectory()
    const path = join(home, 'logs', 'abaco-context.jsonl')
    const logger = recordingLogger()
    const sink = new ObservabilityLog({ path, logger })

    // A cyclic value cannot be serialized: it must be DROPPED LOUDLY, never
    // written as a partial line.
    const cyclic: Record<string, unknown> = { event: 'probe' }
    cyclic.self = cyclic
    expect(sink.write(cyclic)).toBe(false)
    expect(sink.stats().lost).toBe(1)
    expect(logger.lines.some((line) => line.includes('dropped a telemetry record'))).toBe(true)
    expect(await readRecords(path)).toEqual([])

    // A bare newline in a KEY is escaped by `JSON.stringify`, so it round-trips
    // as one record rather than splitting the stream. That is asserted instead
    // of assumed, because stream integrity rests on it.
    const escaped = serializeRecord({ 'a\nb': 1 })
    expect(escaped).toBe('{"a\\nb":1}\n')
    expect(escaped?.split('\n')).toHaveLength(2)
    expect(serializeRecord({ event: 'ok' })).toBe('{"event":"ok"}\n')

    // What protects the stream is that `JSON.stringify` escapes every newline it
    // can produce — measured, not assumed, including the one route a value has to
    // inject raw text (`toJSON`). The serialiser then *checks* for a newline
    // anyway, because that is the property the stream depends on and a future
    // change to the encoder must not be able to break it silently.
    const viaToJson = { event: 'probe', payload: { toJSON: () => 'line one\nline two' } }
    const encoded = serializeRecord(viaToJson)
    expect(encoded).toBe('{"event":"probe","payload":"line one\\nline two"}\n')
    expect(encoded?.split('\n')).toHaveLength(2)

    // The guard itself, exercised where it lives, so that removing it is caught
    // even though `JSON.stringify` currently makes it unreachable in practice.
    expect(guardRejectsNewline('{"a":1}\n{"b":2}')).toBe(true)
    expect(guardRejectsNewline('{"a":1}')).toBe(false)
    // And nothing the sink accepted reached the file.
    expect(await readRecords(path)).toEqual([])
    sink.close()
  })

  it('degrades loudly when the log cannot be written', async () => {
    const home = await temporaryDirectory()
    // A FILE where the logs directory should be: the append must fail, and the
    // failure must be reported rather than swallowed or thrown.
    await writeFile(join(home, 'logs'), 'not a directory', 'utf8')
    const logger = recordingLogger()
    const sink = new ObservabilityLog({ path: join(home, 'logs', 'abaco-context.jsonl'), logger })
    expect(() => sink.write({ event: 'probe' })).not.toThrow()
    expect(sink.stats().errors).toBeGreaterThan(0)
    expect(logger.lines.some((line) => line.includes('could not append telemetry'))).toBe(true)
    sink.close()
  })

  it('writes mode 0600', async () => {
    const home = await temporaryDirectory()
    const path = join(home, 'logs', 'abaco-context.jsonl')
    const sink = new ObservabilityLog({ path, logger: recordingLogger() })
    sink.write({ event: 'probe' })
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    sink.close()
  })

  it('drains asynchronously when asked to', async () => {
    const home = await temporaryDirectory()
    const path = join(home, 'logs', 'abaco-context.jsonl')
    const sink = new ObservabilityLog({ path, logger: recordingLogger(), asyncWrites: true })
    sink.write({ event: 'probe', index: 1 })
    await sink.flush()
    expect(await readRecords(path)).toHaveLength(1)
    sink.close()
  })
})

/* ──────────────────────────────────────────────────────────────────────────────
 * 5. The signals the specification names
 * ────────────────────────────────────────────────────────────────────────────── */

describe('signals', () => {
  it('counts a stock spill notice and a large un-spilled result separately', () => {
    const spillNotice =
      'head text\n\n(12345 bytes omitted from the middle. Full formatted result stored at: /tmp/dsh-spill-x/session-1/bash.txt. Use read with offset/limit, or grep this path.)'
    const spilled = readToolResult(
      { type: 'tool/result', data: { message: { content: [{ name: 'bash', content: [{ type: 'text', text: spillNotice }] }] } } },
      12000
    )
    expect(spilled?.spilled).toBe(true)
    expect(spilled?.large).toBe(false)

    // Above the ceiling with no notice: the policy was asked to spill this and
    // did not, which is a different fact and is counted as one.
    const big = 'a'.repeat(20000)
    const large = readToolResult(
      { type: 'tool/result', data: { message: { content: [{ name: 'read', content: [{ type: 'text', text: big }] }] } } },
      12000
    )
    expect(large?.spilled).toBe(false)
    expect(large?.large).toBe(true)
    expect(large?.bytes).toBe(20000)
    expect(large?.chars).toBe(20000)

    // An ordinary small result counts as neither.
    const small = readToolResult(
      { type: 'tool/result', data: { message: { content: [{ name: 'read', content: [{ type: 'text', text: 'ok' }] }] } } },
      12000
    )
    expect(small?.spilled).toBe(false)
    expect(small?.large).toBe(false)
  })

  it('measures results in code points, matching the engine pruner', () => {
    // An astral character is 1 code point and 2 UTF-16 units. The engine prices
    // with `Array.from(text).length`; a reader that counted `.length` would
    // disagree with the engine about the same result.
    const astral = '\u{1F600}'.repeat(10)
    const reading = readToolResult(
      { type: 'tool/result', data: { message: { content: [{ name: 'read', content: [{ type: 'text', text: astral }] }] } } },
      12000
    )
    expect(reading?.chars).toBe(10)
    expect(reading?.bytes).toBe(40)
  })

  it('reports a missing projection as absent rather than inventing a zero', () => {
    // No services at all: the row must say nothing instead of claiming zero
    // pressure, which would read as "the context is empty".
    expect(readPressure({ sessionProjections: undefined, tokenMeter: undefined, session: {} })).toEqual({})

    // A projection that throws degrades to absent, loudly elsewhere.
    const throwing = {
      snapshot: () => {
        throw new Error('projection exploded')
      }
    }
    expect(readPressure({ sessionProjections: throwing, tokenMeter: undefined, session: {} })).toEqual({})
  })

  it('reads the real ABACO policy document when one exists', async () => {
    const home = await temporaryDirectory()
    await mkdir(join(home, '.agent-presets', 'abaco'), { recursive: true })
    await writeFile(
      join(home, '.agent-presets', 'abaco', 'agent.cordis.yml'),
      [
        'rows:',
        '  - id: compaction-basic',
        "    name: '@deepseek-ai/dsh-compaction-basic'",
        '    config:',
        '      # the owner-locked policy',
        '      thresholdRatio: 0.9',
        '      retainRatio: 0.12',
        '      maxTokens: 8192',
        '      auto: true',
        '  - id: tool-result-pruner',
        "    name: '@deepseek-ai/dsh-compaction-tool-result-pruner'",
        '    config:',
        '      thresholdChars: 6000'
      ].join('\n'),
      'utf8'
    )
    const report = readComposedPolicy({ dshHome: home })
    expect(report.found).toBe(true)
    expect(report.prunerRowFound).toBe(true)
    expect(report.policy).toEqual({
      thresholdRatio: 0.9,
      retainRatio: 0.12,
      retainTokens: undefined,
      maxTokens: 8192,
      auto: true
    })
    expect(report.alerts).toEqual([])

    // An unreadable preset is reported, never thrown.
    const missing = readComposedPolicy({ dshHome: join(home, 'nowhere') })
    expect(missing.found).toBe(false)
    expect(missing.alerts).toContain('compaction-policy-unreadable')
  })

  it('counts repeated reads as the measured degradation signal', async () => {
    const home = await temporaryDirectory()
    const logger = recordingLogger()
    const ctx = new Context()
    await mountRow(ctx, { tokenMeter: tokenMeterWith(0), sessionProjections: pressureLedger(), logger: engineLogger(logger) }, { home })
    const service = createObservability({ ctx, config: { home }, logger })

    const read = (path: string) => ({
      type: 'tool/call',
      seq: 0,
      time: Date.now(),
      data: { turn: 1, step: 1, callId: 'call-1', name: 'read', arguments: JSON.stringify({ path }) }
    })

    service.onSessionEvent({ id: 'session-1' }, read('/tmp/a.txt'))
    expect(service.tracker.totals('session-1')?.compactions ?? 0).toBe(0)
    // Reading two different files is not degradation.
    service.onSessionEvent({ id: 'session-1' }, read('/tmp/b.txt'))

    // A compaction, then the agent asks for a file it already read: the
    // measurable form of "el agente pide de nuevo un dato que ya estaba".
    service.onSessionEvent({ id: 'session-1' }, {
      type: 'compaction/start',
      seq: 1,
      time: Date.now(),
      data: { compactionId: 'c1', turn: 1 }
    })
    service.onSessionEvent({ id: 'session-1' }, {
      type: 'compaction/summary',
      seq: 2,
      time: Date.now(),
      data: {
        compactionId: 'c1',
        summary: [],
        shadowedRange: { start: 1, end: 1 },
        shadowedSeqs: [1],
        shadowedTokenCount: 10,
        provider: 'deepseek',
        model: 'deepseek-v4-flash'
      }
    })
    service.onSessionEvent({ id: 'session-1' }, {
      type: 'user/message',
      seq: 3,
      time: Date.now(),
      data: checkpointMessage('body')
    })
    service.onSessionEvent({ id: 'session-1' }, {
      type: 'compaction/end',
      seq: 4,
      time: Date.now(),
      data: { compactionId: 'c1', turn: 1 }
    })
    service.onSessionEvent({ id: 'session-1' }, read('/tmp/a.txt'))

    // The re-read happened AFTER the compaction, so it is the degradation the
    // signal claims to measure. The list of reads the tracker keeps is asserted
    // directly, because the counter is what the later Phase-0 report reads.
    const seen = service.tracker.readsRepeated('session-1')
    expect(seen).toBeGreaterThanOrEqual(1)

    const records = await readRecords(join(home, 'logs', 'abaco-context.jsonl'))
    expect(records.filter((record) => record.event === 'compaction_end')).toHaveLength(1)
    service.close()
  })

  it('attributes a context overflow to the session that was active', async () => {
    const home = await temporaryDirectory()
    const logger = recordingLogger()
    const ctx = new Context()
    await mountRow(ctx, { tokenMeter: tokenMeterWith(0), sessionProjections: pressureLedger(), logger: engineLogger(logger) }, { home })
    const service = createObservability({ ctx, config: { home }, logger })

    // The session proves it is alive, then the provider says the request did not
    // fit. `agent/request-error` carries no session id, so the attribution is the
    // recency window — and the record says so.
    service.onSessionEvent({ id: 'session-7' }, { type: 'turn/end', seq: 0, time: Date.now(), data: { turn: 1, reason: { kind: 'completed' } } })
    service.onRequestError({ turn: 1, step: 3, provider: 'deepseek', failure: { code: 'CONTEXT_WINDOW_EXCEEDED', message: 'too big' } }, undefined)

    const records = await readRecords(join(home, 'logs', 'abaco-context.jsonl'))
    const overflow = records.find((record) => record.event === 'context_overflow')
    expect(overflow?.sessionId).toBe('session-7')
    expect(overflow?.attribution).toBe('recent-session')

    // And the next compaction for that session is reported as an overflow.
    service.onSessionEvent({ id: 'session-7' }, {
      type: 'compaction/start',
      seq: 1,
      time: Date.now(),
      data: { compactionId: 'c9', turn: 1 }
    })
    service.onSessionEvent({ id: 'session-7' }, {
      type: 'compaction/end',
      seq: 2,
      time: Date.now(),
      data: { compactionId: 'c9', turn: 1 }
    })
    const after = await readRecords(join(home, 'logs', 'abaco-context.jsonl'))
    const end = after.find((record) => record.event === 'compaction_end')
    expect(end?.trigger).toBe('overflow')
    expect(end?.triggerSource).toBe('overflow-attributed')
    service.close()
  })

  it('does not let a stale overflow blame a later compaction', async () => {
    const home = await temporaryDirectory()
    const service = createObservability({ ctx: undefined, config: { home }, logger: recordingLogger() })

    // An overflow with no session active at all is recorded as unattributed and
    // must not colour anything that happens afterwards.
    expect(service.tracker.markOverflow(Date.now())).toBeUndefined()
    service.onRequestError({ failure: { code: 'CONTEXT_WINDOW_EXCEEDED' } }, undefined)
    const records = await readRecords(join(home, 'logs', 'abaco-context.jsonl'))
    expect(records.find((record) => record.event === 'context_overflow')?.attribution).toBe('unattributed')

    service.onSessionEvent({ id: 'session-1' }, {
      type: 'compaction/start',
      seq: 0,
      time: Date.now(),
      data: { compactionId: 'c1', turn: 1 }
    })
    service.onSessionEvent({ id: 'session-1' }, {
      type: 'compaction/end',
      seq: 1,
      time: Date.now(),
      data: { compactionId: 'c1', turn: 1 }
    })
    const after = await readRecords(join(home, 'logs', 'abaco-context.jsonl'))
    expect(after.find((record) => record.event === 'compaction_end')?.trigger).toBe('pressure')
    service.close()
  })

  it('counts retries from the attempt sequence the engine actually produces', async () => {
    const home = await temporaryDirectory()
    const service = createObservability({ ctx: undefined, config: { home }, logger: recordingLogger() })

    const attempt = (id: string) => [
      { type: 'compaction/start', seq: 0, time: Date.now(), data: { compactionId: id, turn: 4 } },
      {
        type: 'compaction/summary',
        seq: 0,
        time: Date.now(),
        data: {
          compactionId: id,
          summary: [],
          shadowedRange: { start: 1, end: 1 },
          shadowedSeqs: [1],
          shadowedTokenCount: 5,
          provider: 'deepseek',
          model: 'm'
        }
      }
    ]
    // Two attempts in the same turn, the first one failing: the observable
    // definition of a retry, since the engine emits no retry event.
    for (const event of attempt('first')) service.onSessionEvent({ id: 's' }, event)
    service.onSessionEvent({ id: 's' }, {
      type: 'compaction/end',
      seq: 0,
      time: Date.now(),
      data: { compactionId: 'first', turn: 4, error: 'SurfaceChangedError' }
    })
    for (const event of attempt('second')) service.onSessionEvent({ id: 's' }, event)
    service.onSessionEvent({ id: 's' }, { type: 'compaction/end', seq: 0, time: Date.now(), data: { compactionId: 'second', turn: 4 } })

    const records = await readRecords(join(home, 'logs', 'abaco-context.jsonl'))
    const ends = records.filter((record) => record.event === 'compaction_end')
    expect(ends).toHaveLength(2)
    expect(ends[0]?.alerts).toContain('compaction-failed')
    expect(ends[0]?.attemptsInTurn).toBe(1)
    expect(ends[0]?.retries).toBe(0)
    // The second attempt in the same turn is the retry: 2 attempts made, of
    // which 1 was a retry. Read from the attempt's own ordinal, so a retry is
    // still visible after the failed attempt has been removed from the map.
    expect(ends[1]?.attemptsInTurn).toBe(2)
    expect(ends[1]?.retries).toBe(1)
    service.close()
  })

  it('never lets a malformed event throw into the engine', async () => {
    const home = await temporaryDirectory()
    const logger = recordingLogger()
    const service = createObservability({ ctx: undefined, config: { home }, logger })

    // Every one of these is a shape the engine does not promise to send, and
    // none of them may reach the append path as an exception.
    const hostile: unknown[] = [
      undefined,
      null,
      {},
      { type: 'compaction/start' },
      { type: 'compaction/start', data: null },
      { type: 'compaction/summary', data: { shadowedSeqs: 'not an array', usage: 42 } },
      { type: 'compaction/end', data: { compactionId: 'never-started' } },
      { type: 'user/message', data: { content: 'not a block array' } },
      { type: 'tool/result', data: { message: { content: 'nope' } } },
      { type: 'tool/call', data: { name: 'read', arguments: 'not json at all' } },
      { type: 'turn/end', data: { reason: { kind: 'error', error: null } } }
    ]
    for (const event of hostile) {
      expect(() => service.onSessionEvent({ id: 's' }, event as never)).not.toThrow()
    }
    expect(() => service.onSessionEvent(undefined, { type: 'compaction/start' } as never)).not.toThrow()
    expect(() => service.onAgentStatus({ status: 42 }, undefined)).not.toThrow()
    expect(() => service.onRequestError(undefined, undefined)).not.toThrow()
    expect(() => service.onRequestError({ failure: { code: 'SOMETHING_ELSE' } }, undefined)).not.toThrow()
    // Whatever survived is valid JSONL, not a partial line.
    const records = await readRecords(join(home, 'logs', 'abaco-context.jsonl'))
    expect(Array.isArray(records)).toBe(true)
    service.close()
  })

  it('turns an internal failure into a warning instead of an exception', async () => {
    const home = await temporaryDirectory()
    const logger = recordingLogger()
    const service = createObservability({ ctx: undefined, config: { home }, logger })

    // Two separate guarantees, and both matter:
    //
    // 1. `readPressure` absorbs a throwing projection by itself, so an ordinary
    //    bad read is not even a warning — it just reports the value as absent.
    const exploding = {
      snapshot: () => {
        throw new Error('projection exploded')
      }
    }
    const degrading = createObservability({
      ctx: { tokenMeter: undefined, sessionProjections: exploding },
      config: { home },
      logger
    })
    expect(() =>
      degrading.onSessionEvent({ id: 'session-1' }, {
        type: 'compaction/start',
        seq: 0,
        time: Date.now(),
        data: { compactionId: 'c', turn: 1 }
      } as never)
    ).not.toThrow()

    // 2. Anything that escapes that must still not reach the engine. This is the
    //    listener's own catch, and it is the difference between "telemetry is
    //    quiet" and "telemetry took the turn down".
    //
    //    The fault is injected where a real one can occur — inside the
    //    session-shaped value the listener reads — rather than by reaching into
    //    the row's internals. `session.id` is the first thing read, so a getter
    //    that throws lands squarely inside the listener body.
    const hostile = createObservability({ ctx: undefined, config: { home }, logger })
    const boobyTrapped = {
      get id() {
        throw new Error('session id exploded')
      }
    }
    expect(() =>
      hostile.onSessionEvent(boobyTrapped as never, {
        type: 'tool/result',
        seq: 0,
        time: Date.now(),
        data: { message: { content: [{ name: 'bash', content: [{ type: 'text', text: 'ok' }] }] } }
      } as never)
    ).not.toThrow()
    // Absorbed AND reported. Asserting the warning is what proves the catch did
    // something, rather than that nothing ever threw — the difference between a
    // test and decoration.
    expect(hostile.issues.some((line) => line.includes('session id exploded'))).toBe(true)
    expect(logger.lines.some((line) => line.includes('session id exploded'))).toBe(true)
    expect(service.issues).toEqual([])
    service.close()
    degrading.close()
    hostile.close()
  })

  it('records agent status transitions for an agent that has a session', async () => {
    const home = await temporaryDirectory()
    const service = createObservability({ ctx: undefined, config: { home }, logger: recordingLogger() })
    service.onAgentStatus({ status: 'running' }, { agent: { session: { id: 'session-9' } } })
    service.onAgentStatus({ status: 'idle' }, { agent: { session: { id: 'session-9' } } })
    // An agent with no session is skipped rather than recorded against nothing.
    service.onAgentStatus({ status: 'running' }, { agent: {} })
    const records = await readRecords(join(home, 'logs', 'abaco-context.jsonl'))
    expect(records.filter((record) => record.event === 'agent_status').map((record) => record.status)).toEqual([
      'running',
      'idle'
    ])
    service.close()
  })

  it('bounds its own memory across sessions and attempts', async () => {
    const home = await temporaryDirectory()
    const service = createObservability({
      ctx: undefined,
      config: { home, maxSessionsTracked: 3, maxAttemptsPerSession: 2 },
      logger: recordingLogger()
    })
    for (let index = 0; index < 10; index += 1) {
      service.onSessionEvent({ id: `session-${String(index)}` }, {
        type: 'compaction/start',
        seq: 0,
        time: index,
        data: { compactionId: `c${String(index)}`, turn: index }
      })
    }
    // A telemetry row that grows without bound is the problem it was mounted to
    // diagnose. The oldest sessions are dropped.
    expect(service.tracker.totals('session-0')).toBeUndefined()
    expect(service.tracker.totals('session-9')).toBeDefined()
    expect(service.tracker.totals('session-9')?.openAttempts).toBeLessThanOrEqual(2)
    service.close()
  })
})
