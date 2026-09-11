import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { validateJsonSchemaValue, type JsonSchemaNode } from '@deepseek-ai/dsh-tools'
import { createScope, scopeTarget } from '@deepseek-ai/dsh-scope'
import { afterEach, describe, expect, it } from 'vitest'
import {
  apply,
  inject,
  name,
  MemoryRenderer,
  MemoryStore,
  MEMORY_FACETS,
  MEMORY_SECTION_NAME,
  MEMORY_SECTION_ORDER,
  resolveMemoryConfig,
  type MemoryAmbient,
  type MemoryConfig,
  type MemorySessionHeader
} from '../packages/abaco-memory/index.js'

/**
 * Layer 2 (durable memory) contract.
 *
 * These tests drive the shipped code path, not a re-implementation of it: the
 * store and the renderer are imported for real, `apply` is mounted both against
 * a minimal recording context and against a **real Cordis context** (with
 * `tools` and `systemPrompt` provided), and the model-facing results are
 * validated with the harness's own `validateJsonSchemaValue` against the schema
 * `defineTool` compiled — the same check `ToolRuntime.createSuccessResult`
 * performs at `dsh-tools/lib/index.js:3418`.
 *
 * The two invariants worth restating, because everything else depends on them:
 *
 * - **The memory lives in sidecar files.** No test here may observe a session
 *   event carrying memory: the durable log's vocabulary is closed, so such an
 *   event would make the session unopenable
 *   (`dsh-session-persistence/lib/index.js:1318-1323`).
 * - **The block is re-evaluated on every assembly**, and a write made during a
 *   turn reaches the prompt at the *next* turn boundary — never mid-turn, which
 *   would invalidate the provider's prefix cache.
 */

/* ──────────────────────────────────────────────────────────────────────────────
 * Fixtures
 * ────────────────────────────────────────────────────────────────────────────── */

const temporaryDirectories: string[] = []

/** A fresh directory, removed after the test. */
async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'abaco-memory-'))
  temporaryDirectories.push(directory)
  return directory
}

/** A fresh memory root (`<DSH_HOME>/abaco-memory`), removed after the test. */
async function memoryRoot(): Promise<string> {
  return join(await temporaryDirectory(), 'abaco-memory')
}

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop()
    if (directory !== undefined) await rm(directory, { recursive: true, force: true })
  }
})

const HEADER: MemorySessionHeader = {
  id: 'session-1',
  cwd: '/Users/dev/abaco_core',
  agentPreset: 'cordis'
}

const AMBIENT: MemoryAmbient = {
  cwd: HEADER.cwd,
  sessionId: HEADER.id,
  agentPreset: HEADER.agentPreset
}

/** The minimal `systemPrompt` assembly context the section's `text` receives. */
function promptContext(header: MemorySessionHeader = HEADER) {
  return { agent: { session: { header } } }
}

/** The tool definition shape `defineTool` produces. */
interface CompiledTool {
  name: string
  description: string
  parameters: JsonSchemaNode
  output: {
    schema: JsonSchemaNode
    render: (args: unknown, value: never) => { type: string; text: string }[]
  }
  execute: (args: Record<string, unknown>, exec: ToolExec) => Promise<Record<string, unknown>>
}

/** The part of a tool execution context the memory tools read. */
interface ToolExec {
  agent?: {
    session: {
      header: MemorySessionHeader
      seq?: number
      eventAt?: (seq: number) => unknown
    }
  }
}

/**
 * The event surface this test drives.
 *
 * Cordis's `Events` interface is closed and augmented per package; the
 * `agent/turn-stopping` entry is declared by `@deepseek-ai/dsh-agent`, which
 * this test deliberately does not load — the point is to exercise the *routing*
 * (`dsh-scope`'s carrier + `Context.filter`), not the agent runtime.
 */
interface ScopedEventBus {
  on(name: string, listener: (payload: unknown) => unknown): unknown
  serial(target: unknown, name: string, ...args: unknown[]): Promise<unknown>
}

/**
 * A recording stand-in for the two services the plugin injects, plus a logger
 * that records what the plugin chose to report — a plugin that degrades has to
 * say so, or the degradation is invisible.
 */
function recordingContext() {
  const tools: CompiledTool[] = []
  const sections: { name: string; order: number; text: (context: unknown) => string }[] = []
  const listeners = new Map<string, (payload: never) => unknown>()
  const logs: { level: string; message: string }[] = []
  const record = (level: string) => (message: string) => {
    logs.push({ level, message: String(message) })
  }
  return {
    tools,
    sections,
    listeners,
    logs,
    ctx: {
      tools: {
        register(definition: CompiledTool) {
          tools.push(definition)
          return () => {}
        }
      },
      systemPrompt: {
        section(section: { name: string; order: number; text: (context: unknown) => string }) {
          sections.push(section)
          return () => {}
        }
      },
      on(event: string, listener: (payload: never) => unknown) {
        listeners.set(event, listener)
        return () => {}
      },
      logger: { info: record('info'), warn: record('warn'), error: record('error') }
    }
  }
}

/** Look one registered tool up, failing loudly when the surface changed. */
function toolNamed(tools: CompiledTool[], toolName: string): CompiledTool {
  const found = tools.find((tool) => tool.name === toolName)
  if (found === undefined) throw new Error(`tool "${toolName}" was not registered`)
  return found
}

/** Every file under `directory`, recursively, with its permission bits. */
async function walk(directory: string): Promise<{ path: string; mode: number }[]> {
  const found: { path: string; mode: number }[] = []
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) found.push(...(await walk(path)))
    else found.push({ path, mode: (await stat(path)).mode & 0o777 })
  }
  return found
}

/** A `set` request with a deliberately wrong `source`, to test the refusal. */
function loosely(request: Record<string, unknown>): Parameters<MemoryStore['set']>[0] {
  return request as unknown as Parameters<MemoryStore['set']>[0]
}

/* ──────────────────────────────────────────────────────────────────────────────
 * The store
 * ────────────────────────────────────────────────────────────────────────────── */

describe('abaco-memory durable store', () => {
  it('writes, rewrites and re-reads one document atomically at 0600', async () => {
    const root = await memoryRoot()
    const store = new MemoryStore({ root })
    await store.load()

    await store.set({ path: 'preferences_user.pref-lang.text', value: 'reporta siempre en español', source: 'user', ambient: AMBIENT })
    const file = store.pathFor('profile', '')
    expect(relative(root, file)).toBe('profile.json')

    // Atomicity is a property a reader can observe: while writers race, every
    // observation of the file is a *complete* JSON document.
    const concurrentWrites = Array.from({ length: 25 }, (_, index) =>
      store.set({
        path: `preferences_user.pref-${index}.text`,
        value: `preferencia número ${index}`,
        source: 'agent:tool',
        ambient: AMBIENT
      })
    )
    const concurrentReads = (async () => {
      const observed: number[] = []
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const document = JSON.parse(await readFile(file, 'utf8')) as {
          version: number
          scope: { kind: string; key: string }
          facets: { preferences_user: unknown[] }
        }
        // Parsing at all is the assertion; the shape checks catch a document
        // assembled from two different writers.
        expect(document.version).toBe(1)
        expect(document.scope.kind).toBe('profile')
        expect(Array.isArray(document.facets.preferences_user)).toBe(true)
        expect(document.facets.preferences_user.length).toBeGreaterThanOrEqual(1)
        expect(document.facets.preferences_user.length).toBeLessThanOrEqual(26)
        observed.push(document.facets.preferences_user.length)
      }
      return observed
    })()

    const [, observed] = await Promise.all([Promise.all(concurrentWrites), concurrentReads])
    expect(observed.length).toBe(40)

    // Re-read through a *fresh* store and a *fresh* renderer: what was
    // committed is what a reopened app puts back in the system prompt, which is
    // the whole point of Layer 2 — "come back tomorrow without re-asking".
    const reopened = new MemoryStore({ root })
    expect(await reopened.load()).toBeGreaterThan(0)
    const read = await reopened.get({ path: 'preferences_user', ambient: AMBIENT })
    expect(read.count).toBe(26)
    expect(read.facets[0]?.entries.some((entry) => entry.text === 'reporta siempre en español')).toBe(true)
    const restarted = new MemoryRenderer({ store: reopened, config: resolveMemoryConfig({ root }) })
    const injected = restarted.sectionText(promptContext())
    expect(injected).toContain('- preferences_user.pref-lang: reporta siempre en español')
    expect(injected).toContain('- preferences_user.pref-0: preferencia número 0')

    // Owner-only, and no half-written siblings left behind.
    const files = await walk(root)
    expect(files.length).toBeGreaterThan(0)
    for (const entry of files) expect(entry.mode).toBe(0o600)
    expect(files.some((entry) => entry.path.endsWith('.tmp'))).toBe(false)
    expect(files.some((entry) => entry.path.endsWith('.lock'))).toBe(false)
    expect((await stat(root)).mode & 0o777).toBe(0o700)
  })

  it('treats a corrupt document as empty, backs it up and keeps serving', async () => {
    const root = await memoryRoot()
    const store = new MemoryStore({ root })
    await store.load()
    await store.set({ path: 'output_format.text', value: 'informe en Markdown', source: 'agent:tool', ambient: AMBIENT })

    // Corrupt the document the way a crashed editor or a full disk would.
    const file = store.pathFor('profile', '')
    const broken = '{ "version": 1, "facets": { "preferences_user": [ '
    await rm(file)
    const { writeFile } = await import('node:fs/promises')
    await writeFile(file, broken)

    const recovered = new MemoryStore({ root })
    await expect(recovered.load()).resolves.toBeTypeOf('number')
    // Empty, not crashing: the partial write did not survive as state.
    const read = await recovered.get({ ambient: AMBIENT })
    expect(read.count).toBe(0)
    expect(read.facets).toEqual([])

    // The broken bytes are preserved, at 0600, next to the document.
    const backups = (await readdir(root)).filter((entry) => entry.includes('.corrupt-'))
    expect(backups.length).toBe(1)
    const backup = join(root, backups[0] as string)
    expect(await readFile(backup, 'utf8')).toBe(broken)
    expect((await stat(backup)).mode & 0o777).toBe(0o600)

    // The journal says what happened, and the store is usable again.
    const journal = await readFile(join(root, 'audit', 'memory.jsonl'), 'utf8')
    expect(journal).toContain('"op":"quarantine"')
    await recovered.set({ path: 'output_format.text', value: 'informe en Markdown', source: 'agent:tool', ambient: AMBIENT })
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ version: 1 })
  })

  it('refuses a write without provenance and one that carries a report', async () => {
    const root = await memoryRoot()
    const store = new MemoryStore({ root, maxEntryChars: 40 })
    await store.load()

    for (const source of [undefined, '', 'assistant', 'user turn 3']) {
      await expect(
        store.set(loosely({ path: 'facts[+]', value: 'algo', source, ambient: AMBIENT }))
      ).rejects.toThrow(/provenance/u)
    }

    await expect(
      store.set({ path: 'facts[+]', value: 'x'.repeat(41), source: 'agent:tool', ambient: AMBIENT })
    ).rejects.toThrow(/over the 40-character cap/u)

    // The refusal is not a silent truncation: nothing was written.
    expect((await store.get({ path: 'facts', ambient: AMBIENT })).count).toBe(0)
    await expect(
      store.set({ path: 'unknown_facet.thing', value: 'x', source: 'agent:tool', ambient: AMBIENT })
    ).rejects.toThrow(/unknown memory facet/u)
    await expect(
      store.set({ path: 'facts.x.id', value: 'x', source: 'agent:tool', ambient: AMBIENT, scope: 'galaxy' })
    ).rejects.toThrow(/unknown memory scope/u)
  })

  it('files each facet in its own scope, accepting the aliases the model writes', async () => {
    const root = await memoryRoot()
    const store = new MemoryStore({ root })
    await store.load()
    const source = 'agent:tool'

    const preference = await store.set({ path: 'usuario.preferencias-idioma.text', value: 'español, siempre', source, ambient: AMBIENT })
    const fact = await store.set({ path: 'hechos[+]', value: 'el motor compacta en agent/pre-step', source, ambient: AMBIENT })
    const task = await store.set({ path: 'tareas.tarea-1', value: { text: 'cerrar la fase 2', status: 'in_progress', next_action: 'escribir los tests' }, source, ambient: AMBIENT })
    const identity = await store.set({ path: 'identidad.agent_role', value: 'PUNTA', source, ambient: AMBIENT })

    // The natural scope of each facet decides the file, which is what keeps the
    // layout matching design §2.1 rather than the caller's mood.
    expect(preference.scope).toEqual({ kind: 'profile', key: '' })
    expect(fact.scope.kind).toBe('project')
    expect(task.scope.kind).toBe('session')
    expect(identity.scope.kind).toBe('role')

    expect(relative(root, store.pathFor('project', fact.scope.key))).toBe(
      `projects/${fact.scope.key}.json`
    )
    expect(relative(root, store.pathFor('session', task.scope.key))).toBe(`sessions/${task.scope.key}.json`)
    expect(relative(root, store.pathFor('role', identity.scope.key))).toBe(`roles/${identity.scope.key}.json`)
    // Never a raw path as a file name.
    expect(preference.facet).toBe('preferences_user')
    expect(fact.facet).toBe('facts')
    expect(task.id).toBe('tarea-1')

    // A caller may override the scope; the renderer still reads it back.
    await store.set({ path: 'decisions.dec-1', value: 'no se modifica ningún paquete publicado', source, ambient: AMBIENT, scope: 'profile' })
    const session = await store.get({ scope: 'session', ambient: AMBIENT })
    expect(session.facets.map((facet) => facet.facet)).toContain('tasks')
    const profile = await store.get({ scope: 'profile', ambient: AMBIENT })
    expect(profile.facets.map((facet) => facet.facet)).toEqual(expect.arrayContaining(['preferences_user', 'decisions']))
  })

  it('dedupes an append, lets a user correction win, and forgets on request', async () => {
    const root = await memoryRoot()
    const store = new MemoryStore({ root })
    await store.load()
    const source = 'agent:tool'

    const first = await store.set({ path: 'preferences_user[+]', value: 'nunca inventes fuentes', source, ambient: AMBIENT })
    const twin = await store.set({ path: 'preferences_user[+]', value: '  Nunca   inventes fuentes ', source, ambient: AMBIENT })
    expect(twin.action).toBe('updated')
    expect(twin.id).toBe(first.id)
    expect((await store.get({ path: 'preferences_user', ambient: AMBIENT })).count).toBe(1)

    // A user correction replaces the agent's wording and takes the top priority.
    const corrected = await store.set({ path: `preferences_user.${first.id}.text`, value: 'cita siempre la URL exacta', source: 'user', ambient: AMBIENT })
    expect(corrected.action).toBe('updated')
    const entries = (await store.get({ path: 'preferences_user', ambient: AMBIENT })).facets[0]?.entries ?? []
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ text: 'cita siempre la URL exacta', source: 'user', priority: 3, pinned: true })

    const forgotten = await store.forget({ path: `preferences_user.${first.id}`, ambient: AMBIENT })
    expect(forgotten.removed).toBe(1)
    expect((await store.get({ path: 'preferences_user', ambient: AMBIENT })).count).toBe(0)
    // Forget is journaled, never silent.
    const journal = await readFile(join(root, 'audit', 'memory.jsonl'), 'utf8')
    expect(journal).toContain('"op":"forget"')
    expect(journal).toContain('"op":"set"')
  })

  it('archives what expires or overflows a facet cap instead of dropping it', async () => {
    const root = await memoryRoot()
    const store = new MemoryStore({ root })
    await store.load()

    await store.set({
      path: 'facts.fact-ttl.text',
      value: 'vigente hoy',
      source: 'agent:tool',
      ttlDays: 1,
      ambient: AMBIENT,
      now: '2026-01-01T00:00:00.000Z'
    })
    expect((await store.get({ path: 'facts', ambient: AMBIENT })).count).toBe(1)
    const archived = await store.gc('2026-03-01T00:00:00.000Z')
    expect(archived).toBe(1)
    expect((await store.get({ path: 'facts', ambient: AMBIENT })).count).toBe(0)

    // `tasks` caps at 20; the twenty-first write evicts the oldest of the
    // lowest priority. Explicit clocks, because the rule is recency-based and
    // twenty-one writes inside one millisecond would tie.
    const cap = MEMORY_FACETS.tasks?.cap ?? 0
    expect(cap).toBe(20)
    for (let index = 0; index < cap + 1; index += 1) {
      await store.set({
        path: `tasks.task-${String(index).padStart(2, '0')}`,
        value: `tarea ${index}`,
        source: 'agent:tool',
        ambient: AMBIENT,
        now: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString()
      })
    }
    const tasks = await store.get({ path: 'tasks', ambient: AMBIENT })
    expect(tasks.count).toBe(cap)
    expect(tasks.facets[0]?.entries.some((entry) => entry.id === 'task-00')).toBe(false)
    expect(tasks.facets[0]?.entries.some((entry) => entry.id === `task-${cap}`)).toBe(true)

    const archive = await readFile(join(root, 'audit', 'archive', `${new Date().toISOString().slice(0, 7)}.jsonl`), 'utf8')
    expect(archive).toContain('"reason":"over-cap"')
    expect(archive).toContain('"reason":"expired"')
    expect((await stat(join(root, 'audit', 'archive', `${new Date().toISOString().slice(0, 7)}.jsonl`))).mode & 0o777).toBe(0o600)
  })
})

/* ──────────────────────────────────────────────────────────────────────────────
 * The prompt section
 * ────────────────────────────────────────────────────────────────────────────── */

describe('abaco-memory prompt injection', () => {
  it('renders the durable entries as a compact block under the reserved order', async () => {
    const root = await memoryRoot()
    const store = new MemoryStore({ root })
    await store.load()
    const config = resolveMemoryConfig({ root })
    const renderer = new MemoryRenderer({ store, config })

    // Nothing durable yet: an empty section, so it costs nothing in the prompt.
    // Asserted on a *different* session, because the block is frozen for the
    // turn: the first render of a session is the one its whole turn sees.
    expect(renderer.sectionText(promptContext({ ...HEADER, id: 'session-empty' }))).toBe('')
    // And no agent in context (a host-side assembly) is not an error.
    expect(renderer.sectionText({})).toBe('')

    await store.set({ path: 'usuario.preferencias.idioma', value: 'español', source: 'user', ambient: AMBIENT })
    await store.set({ path: 'proyecto.estado', value: 'fase 2 de memoria durable en curso', source: 'agent:tool', ambient: AMBIENT })
    await store.set({ path: 'formato_salida.text', value: 'informe Markdown con Hallazgos/Fuentes/Riesgos', source: 'user', ambient: AMBIENT })
    await store.set({ path: 'tareas.t1', value: { text: 'escribir los tests', status: 'in_progress', next_action: 'vitest run' }, source: 'agent:tool', ambient: AMBIENT })

    const text = renderer.sectionText(promptContext())
    expect(text.startsWith('## ABACO DURABLE MEMORY')).toBe(true)
    expect(text).toContain('- preferences_user.idioma: español')
    expect(text).toContain('projects_state.estado: fase 2 de memoria durable en curso')
    expect(text).toContain('output_format.text: informe Markdown con Hallazgos/Fuentes/Riesgos')
    expect(text).toContain('tasks.t1: escribir los tests [in_progress] next: vitest run')
    // The user's own words come first, because the facets are injected in the
    // order design §3.3 fixes, not in storage order.
    expect(text.indexOf('preferences_user.')).toBeLessThan(text.indexOf('projects_state.'))

    const outcome = renderer.render(AMBIENT)
    expect(outcome.included).toBeGreaterThanOrEqual(4)
    expect(outcome.dropped).toBe(0)
    expect(MEMORY_SECTION_NAME).toBe('abaco:durable-memory')
    expect(MEMORY_SECTION_ORDER).toBe(200)
  })

  it('respects the global budget and the per-scope shares, and reports the drops', async () => {
    const root = await memoryRoot()
    const store = new MemoryStore({ root })
    await store.load()
    for (let index = 0; index < 12; index += 1) {
      await store.set({
        path: `preferences_user.pref-${index}.text`,
        value: `preferencia del usuario número ${index} con texto suficiente para ocupar espacio`,
        source: 'user',
        ambient: AMBIENT
      })
      await store.set({
        path: `decisions.dec-${index}`,
        value: `decisión número ${index} con su justificación breve`,
        source: 'agent:tool',
        ambient: AMBIENT
      })
    }

    // A profile share small enough to bite while the project share is untouched:
    // one chatty document must not starve the others.
    const scoped = new MemoryRenderer({
      store,
      config: resolveMemoryConfig({ root, maxRenderChars: 6000, scopeBudgets: { profile: 260, project: 2500, session: 1500, role: 500 } })
    })
    const scopedText = scoped.sectionText(promptContext())
    expect(scopedText.length).toBeLessThanOrEqual(6000)
    expect(scopedText).toContain('decisions.dec-')
    expect((scopedText.match(/^- preferences_user\./gmu) ?? []).length).toBeLessThan(12)
    expect(scoped.render(AMBIENT).dropped).toBeGreaterThan(0)

    const tight = new MemoryRenderer({ store, config: resolveMemoryConfig({ root, maxRenderChars: 700 }) })
    const tightText = tight.sectionText(promptContext())
    expect(tightText.length).toBeLessThanOrEqual(700)
    expect(tightText.startsWith('## ABACO DURABLE MEMORY')).toBe(true)
    expect(tightText).toContain('did not fit this block')

    // Below the header's own size there is nothing honest to inject.
    const impossible = new MemoryRenderer({ store, config: resolveMemoryConfig({ root, maxRenderChars: 60 }) })
    expect(impossible.sectionText(promptContext())).toBe('')
  })

  it('freezes the block for a turn and refreshes it at the turn boundary', async () => {
    const root = await memoryRoot()
    const store = new MemoryStore({ root })
    await store.load()
    const renderer = new MemoryRenderer({ store, config: resolveMemoryConfig({ root }) })

    await store.set({ path: 'proyecto.estado', value: 'primer estado', source: 'agent:tool', ambient: AMBIENT })
    const first = renderer.sectionText(promptContext())
    expect(first).toContain('primer estado')

    // A write during the turn must not rewrite the system prompt mid-task:
    // changing it would flip `request/header` to `reason: "change"` and cost
    // the provider's prefix cache.
    await store.set({ path: 'proyecto.estado', value: 'segundo estado', source: 'agent:tool', ambient: AMBIENT })
    expect(renderer.sectionText(promptContext())).toBe(first)

    renderer.invalidate(HEADER.id as string)
    const refreshed = renderer.sectionText(promptContext())
    expect(refreshed).toContain('segundo estado')
    expect(refreshed).not.toBe(first)

    // `freezePerTurn: false` is the escape hatch: the block follows every write.
    const eager = new MemoryRenderer({ store, config: resolveMemoryConfig({ root, freezePerTurn: false }) })
    expect(eager.sectionText(promptContext())).toContain('segundo estado')
    await store.set({ path: 'proyecto.estado', value: 'tercer estado', source: 'agent:tool', ambient: AMBIENT })
    expect(eager.sectionText(promptContext())).toContain('tercer estado')
  })

  it('stays out of delegated children unless it is asked for', async () => {
    const root = await memoryRoot()
    const store = new MemoryStore({ root })
    await store.load()
    await store.set({ path: 'proyecto.estado', value: 'algo durable', source: 'agent:tool', ambient: AMBIENT })

    const child: MemorySessionHeader = { ...HEADER, id: 'session-child', origin: 'subagent', delegationDepth: 1 }
    const quiet = new MemoryRenderer({ store, config: resolveMemoryConfig({ root }) })
    expect(quiet.sectionText(promptContext(child))).toBe('')
    // ... and never the *other* session's live state, even when it does render.
    const loud = new MemoryRenderer({ store, config: resolveMemoryConfig({ root, includeInSubagents: true }) })
    const childText = loud.sectionText(promptContext(child))
    expect(childText).toContain('algo durable')
    const childStore = await store.get({ scope: 'session', ambient: { ...AMBIENT, sessionId: 'session-child' } })
    expect(childStore.count).toBe(0)

    // The same is true of an agent only identified by delegation depth.
    expect(quiet.sectionText(promptContext({ ...HEADER, id: 'session-depth', delegationDepth: 2 }))).toBe('')
  })

  it('renders nothing rather than throwing when the store is unusable', async () => {
    const store = new MemoryStore({ root: join(await temporaryDirectory(), 'never-created', 'abaco-memory') })
    const renderer = new MemoryRenderer({
      store,
      config: resolveMemoryConfig({ root: store.root })
    })
    // A store that was never loaded renders empty; a throwing section would
    // fail every model step of the session.
    expect(renderer.sectionText(promptContext())).toBe('')
    expect(() => renderer.sectionText({ agent: { session: {} } })).not.toThrow()
    expect(renderer.sectionText({ agent: { session: undefined } })).toBe('')
  })
})

/* ──────────────────────────────────────────────────────────────────────────────
 * Mounting
 * ────────────────────────────────────────────────────────────────────────────── */

describe('abaco-memory mounting', () => {
  it('registers the memory tools against the real defineTool schema compiler', async () => {
    const root = await memoryRoot()
    const { ctx, tools, sections, listeners } = recordingContext()
    await apply(ctx, { root })

    expect(name).toBe('abaco-memory')
    expect(inject).toEqual(['tools', 'systemPrompt'])
    expect(tools.map((tool) => tool.name)).toEqual([
      'abaco_memory_set',
      'abaco_memory_get',
      'abaco_memory_forget',
      'abaco_memory_list',
      'abaco_memory_note'
    ])
    // `defineTool` compiled and validated every spec against the harness's own
    // DSL before it reached this registry, so a malformed spec would already
    // have thrown. What is read here is the compiled JSON Schema the model
    // actually receives.
    const shape = Object.fromEntries(
      tools.map((tool) => [
        tool.name,
        {
          properties: Object.keys((tool.parameters as { properties: Record<string, unknown> }).properties).sort(),
          required: [...((tool.parameters as { required?: string[] }).required ?? [])].sort()
        }
      ])
    )
    expect(shape).toEqual({
      abaco_memory_set: {
        properties: ['key', 'priority', 'scope', 'source', 'ttl', 'value', 'why'],
        required: ['key', 'value']
      },
      abaco_memory_get: { properties: ['key', 'scope'], required: [] },
      abaco_memory_forget: { properties: ['key', 'scope'], required: ['key'] },
      abaco_memory_list: { properties: [], required: [] },
      abaco_memory_note: { properties: ['phase', 'source', 'text'], required: ['text'] }
    })
    // The value is `json` in the harness DSL, i.e. an annotation-only schema:
    // a string and an object are both legal, which is what makes the tool
    // callable on the first try.
    const valueSpec = (toolNamed(tools, 'abaco_memory_set').parameters as { properties: Record<string, JsonSchemaNode> }).properties.value
    expect(Object.keys(valueSpec ?? {})).toEqual(expect.arrayContaining(['description']))

    expect(sections).toHaveLength(1)
    expect(sections[0]?.name).toBe(MEMORY_SECTION_NAME)
    expect(sections[0]?.order).toBe(MEMORY_SECTION_ORDER)
    expect(typeof sections[0]?.text).toBe('function')
    // The turn boundary is wired: it is what unfreezes the block.
    expect(listeners.has('agent/turn-stopping')).toBe(true)
    expect(listeners.has('agent/disposed')).toBe(true)
  })

  it('sets, gets and forgets against a temporary DSH_HOME', async () => {
    const home = await temporaryDirectory()
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      // The root is derived from the environment the shell sets for every
      // harness child, so a packaged app writes inside its own harness home.
      expect(resolveMemoryConfig({}).root).toBe(join(home, 'abaco-memory'))
      expect(resolveMemoryConfig({ root: '/tmp/explicit-memory' }).root).toBe('/tmp/explicit-memory')
      expect(resolveMemoryConfig({}).maxRenderChars).toBe(6000)
      expect(resolveMemoryConfig({}).maxEntryChars).toBe(240)

      const { ctx, tools, sections } = recordingContext()
      await apply(ctx, {})
      const setTool = toolNamed(tools, 'abaco_memory_set')
      const getTool = toolNamed(tools, 'abaco_memory_get')
      const forgetTool = toolNamed(tools, 'abaco_memory_forget')
      const listTool = toolNamed(tools, 'abaco_memory_list')

      // A session mid-turn: provenance must come out as the agent and the turn.
      const events = [
        { type: 'turn/start', data: { turn: 3 } },
        { type: 'turn/end', data: { turn: 3 } },
        { type: 'turn/start', data: { turn: 4 } }
      ]
      const exec: ToolExec = {
        agent: {
          session: {
            header: HEADER,
            seq: events.length,
            eventAt: (seq: number) => events[seq]
          }
        }
      }

      const written = await setTool.execute(
        { key: 'preferences_user.pref-lang.text', value: 'reporta siempre en español', source: 'user' },
        exec
      )
      expect(written).toMatchObject({ ok: true, facet: 'preferences_user', scope: 'profile', action: 'created' })

      const derived = await setTool.execute({ key: 'proyecto.estado', value: 'fase 2 en curso' }, exec)
      expect(derived).toMatchObject({ ok: true, scope: 'project' })

      const artifact = await setTool.execute(
        {
          key: 'artefactos[+]',
          value: { text: 'informe de mercado', locator: join(home, 'abaco-memory', 'vault', 'informe.txt'), bytes: 184320 },
          priority: 2
        },
        exec
      )
      expect(artifact).toMatchObject({ facet: 'artifacts', action: 'created' })

      const read = await getTool.execute({}, exec)
      expect(read.found).toBe(true)
      expect(Array.isArray(read.entries)).toBe(true)
      expect((read.locators as string[]).length).toBe(1)
      expect(
        (read.entries as { text: string; source: string }[]).some((entry) => entry.text === 'reporta siempre en español')
      ).toBe(true)
      // Provenance is visible, and the user's own words are marked as such.
      const preference = (read.entries as { source: string; priority: number; pinned: boolean }[]).find(
        (entry) => entry.source === 'user'
      )
      expect(preference).toMatchObject({ priority: 3, pinned: true })
      // The derived provenance really is the turn, not a blank.
      const state = await getTool.execute({ key: 'proyecto.estado' }, exec)
      expect((state.entries as { source: string }[])[0]?.source).toBe('agent:turn-4')

      const listed = await listTool.execute({}, exec)
      expect(listed.total).toBe(3)
      expect(listed.root).toBe(join(home, 'abaco-memory'))

      const removed = await forgetTool.execute({ key: 'proyecto.estado' }, exec)
      expect(removed).toMatchObject({ ok: true, removed: 1, scope: 'project' })

      // Every value a tool returns is validated by the runtime against the very
      // schema `defineTool` compiled (`dsh-tools/lib/index.js:3418`), so the
      // test validates it the same way instead of trusting the renderer.
      for (const [tool, value] of [
        [setTool, written],
        [setTool, derived],
        [setTool, artifact],
        [getTool, read],
        [getTool, state],
        [listTool, listed],
        [forgetTool, removed]
      ] as [CompiledTool, Record<string, unknown>][]) {
        expect(validateJsonSchemaValue(tool.output.schema, value, 'value')).toEqual([])
        const blocks = tool.output.render({}, value as never)
        expect(blocks[0]?.type).toBe('text')
        expect((blocks[0]?.text ?? '').length).toBeGreaterThan(0)
      }

      // The prompt section now carries the memory the tools wrote.
      const text = sections[0]?.text(promptContext())
      expect(text).toContain('## ABACO DURABLE MEMORY')
      expect(text).toContain('preferences_user.pref-lang: reporta siempre en español')
      expect(text).toContain('artifacts.')
      expect(text).not.toContain('projects_state.estado: fase 2 en curso')
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })

  it('runs its turn-boundary bookkeeping on a real, agent-scoped cordis dispatch', async () => {
    const root = await memoryRoot()
    const { ctx, tools, sections, listeners } = recordingContext()
    await apply(ctx, { root })
    const setTool = toolNamed(tools, 'abaco_memory_set')
    const exec: ToolExec = { agent: { session: { header: HEADER } } }

    await setTool.execute({ key: 'proyecto.estado', value: 'antes del turno' }, exec)
    await setTool.execute({ key: 'tareas.turno-7', value: { text: 'cerrar el turno', status: 'in_progress' } }, exec)
    const frozen = sections[0]?.text(promptContext())
    expect(frozen).toContain('antes del turno')
    expect(frozen).toContain('tasks.turno-7')
    await setTool.execute({ key: 'proyecto.estado', value: 'escrito dentro del turno' }, exec)
    expect(sections[0]?.text(promptContext())).toBe(frozen)

    // `agent/turn-stopping` is dispatched serially with the agent as its scope
    // carrier (`dsh-agent-loop/lib/index.js:570`, `dsh-agent/lib/index.js:335`).
    // This is the exact dispatch the harness performs, through the real event
    // bus, so the assumption Layer 2 rests on is tested rather than assumed:
    // a *host-plane* listener is admitted for every agent scope, which is what
    // lets one memory store serve every agent and preset.
    //
    // The bus is viewed through a plain `{ on, serial }` surface because the
    // `agent/turn-stopping` entry itself is declared by `@deepseek-ai/dsh-agent`,
    // which this test deliberately does not load.
    const context = new Context()
    const bus = context as unknown as ScopedEventBus
    const reached: unknown[] = []
    bus.on('agent/turn-stopping', (payload) => {
      reached.push(payload)
    })
    const agent = { session: { header: HEADER } }
    const other = { session: { header: { ...HEADER, id: 'session-2' } } }
    await bus.serial(scopeTarget(agent, agent), 'agent/turn-stopping', { agent, turn: 7, signal: undefined })
    expect(reached).toHaveLength(1)
    await bus.serial(scopeTarget(other, other), 'agent/turn-stopping', { agent: other, turn: 1 })
    expect(reached).toHaveLength(2)

    // ... while a listener minted *inside* one agent's scope sees only its own:
    // the routing is what keeps one agent's turn boundary from touching another.
    const scopedSeen: unknown[] = []
    const scope = createScope(context, other)
    const scopedBus = scope.ctx as unknown as ScopedEventBus
    scopedBus.on('agent/turn-stopping', (payload) => {
      scopedSeen.push(payload)
    })
    await bus.serial(scopeTarget(other, other), 'agent/turn-stopping', { agent: other, turn: 2 })
    expect(scopedSeen).toHaveLength(1)
    await bus.serial(scopeTarget(agent, agent), 'agent/turn-stopping', { agent, turn: 8 })
    expect(scopedSeen).toHaveLength(1)
    await scope.dispose()

    const handler = listeners.get('agent/turn-stopping')
    expect(handler).toBeDefined()
    await handler?.({ agent, turn: 7 } as never)

    // The turn boundary did three things: unfroze the block, recorded the turn,
    // and persisted the session document.
    const refreshed = sections[0]?.text(promptContext())
    expect(refreshed).toContain('escrito dentro del turno')
    const sessionFile = join(root, 'sessions', 'session-1.json')
    const document = JSON.parse(await readFile(sessionFile, 'utf8')) as {
      meta: { lastTurn: number; lastWriteReason: string; renders: number }
      facets: Record<string, unknown>
    }
    expect(document.meta.lastTurn).toBe(7)
    expect(document.meta.lastWriteReason).toBe('turn-stop')
    expect(document.meta.renders).toBeGreaterThan(0)
    expect(Object.keys(document.facets)).toContain('tasks')
    expect((await stat(sessionFile)).mode & 0o777).toBe(0o600)

    // A session that never remembered anything is bookkeeping without content:
    // its counters stay live, but it does not collect a file that would slowly
    // fill the bounded boot scan with empty documents.
    await handler?.({ agent: other, turn: 1 } as never)
    await expect(stat(join(root, 'sessions', 'session-2.json'))).rejects.toThrow(/ENOENT/u)

    // Disposal only drops the cache entry; it must not throw or write.
    expect(() => listeners.get('agent/disposed')?.({ agent } as never)).not.toThrow()
  })

  it('mounts into a real cordis context with its declared injections only', async () => {
    const root = await memoryRoot()
    const ctx = new Context()
    const registered: string[] = []
    const sections: string[] = []
    const provide = ctx.provide.bind(ctx) as (name: string, value: unknown) => () => void
    provide('tools', {
      register: (definition: { name: string }) => {
        registered.push(definition.name)
        return () => {}
      }
    })
    provide('systemPrompt', {
      section: (section: { name: string }) => {
        sections.push(section.name)
        return () => {}
      }
    })

    // The descriptor is built from the plugin's own exports, so `inject` is
    // resolved by Cordis exactly as it is in the composed profile: a service
    // this plugin reads but does not declare fails here, not in production.
    await ctx.plugin({ name, inject: [...inject], apply })
    expect(registered).toHaveLength(5)
    expect(sections).toEqual([MEMORY_SECTION_NAME])
    expect(registered).toContain('abaco_memory_set')
  })

  it('never rejects, so an unwritable memory root cannot break the plugin tree', async () => {
    // A root that cannot exist: its parent is a regular file, so every mkdir
    // and every open under it fails with ENOTDIR.
    const home = await temporaryDirectory()
    const blocker = join(home, 'not-a-directory')
    await writeFile(blocker, 'this is a file, not a directory\n')
    const root = join(blocker, 'abaco-memory')

    const { ctx, tools, sections, listeners, logs } = recordingContext()
    // The one thing that matters: a host-plane plugin that rejects takes the
    // whole Cordis tree down with it, so this must resolve.
    await expect(apply(ctx, { root })).resolves.toBeUndefined()

    // Memory is empty for this launch, and the log says why.
    expect(sections).toHaveLength(1)
    expect(sections[0]?.text(promptContext())).toBe('')
    expect(logs.some((entry) => entry.level !== 'info' && entry.message.includes('memory snapshot'))).toBe(true)

    // The surface stays mounted: the model can still call the tools, and a
    // failed write is reported to it instead of vanishing.
    expect(tools).toHaveLength(5)
    expect(listeners.has('agent/turn-stopping')).toBe(true)
    const setTool = toolNamed(tools, 'abaco_memory_set')
    const exec: ToolExec = { agent: { session: { header: HEADER } } }
    await expect(setTool.execute({ key: 'proyecto.estado', value: 'algo' }, exec)).rejects.toThrow(
      /abaco_memory_set failed/u
    )

    // The turn boundary is equally contained: it runs during a serial dispatch
    // the loop awaits, so a rejection here would surface as a turn failure.
    await expect(listeners.get('agent/turn-stopping')?.({ agent: exec.agent, turn: 1 } as never)).resolves.toBeUndefined()
    expect(logs.some((entry) => entry.message.includes('turn-stop bookkeeping failed'))).toBe(true)
  })

  it('resolves for a garbage config instead of refusing to load', async () => {
    const home = await temporaryDirectory()
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      // A row whose config was typed by hand: every value here is wrong, and
      // every one of them must degrade to its default rather than fail.
      const { ctx, tools, sections } = recordingContext()
      await expect(
        apply(ctx, {
          root: 42,
          enabled: 'yes',
          maxRenderChars: 'huge',
          maxEntryChars: -3,
          scopeBudgets: 'none',
          lockWaitMs: 0,
          maxBootDocs: null,
          freezePerTurn: 'maybe',
          includeInSubagents: 'sure'
        })
      ).resolves.toBeUndefined()

      // The unusable root fell back to <DSH_HOME>/abaco-memory, so the plugin
      // is fully live rather than half-mounted.
      expect(tools).toHaveLength(5)
      expect(sections).toHaveLength(1)
      const setTool = toolNamed(tools, 'abaco_memory_set')
      const exec: ToolExec = { agent: { session: { header: HEADER } } }
      await expect(setTool.execute({ key: 'proyecto.estado', value: 'sigue vivo' }, exec)).resolves.toMatchObject({
        ok: true
      })
      expect(await readFile(join(home, 'abaco-memory', 'projects', '--Users-dev-abaco_core--.json'), 'utf8')).toContain(
        'sigue vivo'
      )

      // Every resolved default is the safe one, and none is a NaN or a string.
      const resolved = resolveMemoryConfig({
        maxRenderChars: 'huge',
        maxEntryChars: -3,
        scopeBudgets: 'none',
        freezePerTurn: 'maybe',
        includeInSubagents: 'sure'
      })
      expect(resolved.maxRenderChars).toBe(6000)
      expect(resolved.maxEntryChars).toBe(240)
      expect(resolved.scopeBudgets).toEqual({ profile: 1500, project: 2500, session: 1500, role: 500 })
      expect(resolved.freezePerTurn).toBe(true)
      expect(resolved.includeInSubagents).toBe(false)
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })

  it('reads only the services it declares and never assigns onto ctx', async () => {
    const files = ['index.js', 'lib/schema.js', 'lib/store.js', 'lib/render.js', 'lib/tools.js']
    const sources = await Promise.all(files.map((file) => readFile(`packages/abaco-memory/${file}`, 'utf8')))
    const source = sources[0] as string
    const manifest = JSON.parse(await readFile('packages/abaco-memory/package.json', 'utf8')) as {
      name: string
      type: string
      main: string
      exports: Record<string, unknown>
      peerDependencies: Record<string, string>
      dsh?: unknown
    }

    expect(manifest.name).toBe('abaco-memory')
    expect(manifest.type).toBe('module')
    expect(manifest.main).toBe('./index.js')
    expect(manifest.exports['.']).toBeDefined()
    expect(manifest.exports['./package.json']).toBeDefined()
    // A host-only plugin must not advertise a client half: the loader serves
    // `<name>/client.js` for any package that declares `dsh.client`, and there
    // is no such file here. `dsh-desktop-preset-transfer` is the precedent.
    expect(manifest.dsh).toBeUndefined()
    expect(manifest.peerDependencies['@deepseek-ai/cordis']).toBeDefined()
    expect(manifest.peerDependencies['@deepseek-ai/dsh-tools']).toBeDefined()

    expect(source).toContain("const inject = ['tools', 'systemPrompt']")
    // Comments talk about `ctx` at length, so the assertion runs on code with
    // them stripped: outside a comment, the only members reachable through
    // `ctx` are the two declared services plus the built-in logger and the
    // event bus, and nothing is ever *assigned* onto it — which is what breaks
    // the Cordis tree and why five `abaco-*` rows are disabled today.
    const code = sources
      .join('\n')
      .replace(/\/\*[\s\S]*?\*\//gu, '')
      .replace(/^\s*\/\/.*$/gmu, '')
    const touched = [...code.matchAll(/\bctx\??\.([A-Za-z_$][\w$]*)/gu)].map((match) => match[1])
    expect([...new Set(touched)].sort()).toEqual(['logger', 'on', 'systemPrompt', 'tools'])
    expect(code).not.toMatch(/ctx\??\.[A-Za-z_$][\w$]*\s*=(?!=)/u)
    // The prohibited persistence path: a memory event would write a session log
    // this harness refuses to reopen.
    expect(code).not.toContain('session.append')
    expect(code).not.toContain(".append('abaco")
    expect(code).not.toContain('.append("abaco')
    expect(code).not.toContain('import { SessionSeq }')
    expect(source).toContain('abaco-memory')
  })
})

/* ──────────────────────────────────────────────────────────────────────────────
 * Configuration
 * ────────────────────────────────────────────────────────────────────────────── */

describe('abaco-memory configuration', () => {
  it('resolves the data layout the design fixes, and every default', async () => {
    const root = await memoryRoot()
    const config: MemoryConfig = resolveMemoryConfig({ root })
    expect(config.root).toBe(root)
    expect(config.enabled).toBe(true)
    expect(config.freezePerTurn).toBe(true)
    expect(config.includeInSubagents).toBe(false)
    expect(config.scopeBudgets).toEqual({ profile: 1500, project: 2500, session: 1500, role: 500 })

    // Every facet the design lists exists, in the scope it belongs to.
    expect(Object.keys(MEMORY_FACETS).sort()).toEqual([
      'artifacts',
      'constraints_do_not',
      'decisions',
      'facts',
      'identity',
      'meta',
      'open_questions',
      'output_format',
      'preferences_user',
      'projects_state',
      'tasks'
    ])
    expect(MEMORY_FACETS.preferences_user?.scope).toBe('profile')
    expect(MEMORY_FACETS.facts?.scope).toBe('project')
    expect(MEMORY_FACETS.tasks?.scope).toBe('session')
    expect(MEMORY_FACETS.identity?.scope).toBe('role')
    expect(MEMORY_FACETS.meta).toMatchObject({ scope: 'session', kind: 'record', injected: false, phase: 'note' })
    expect(MEMORY_FACETS.preferences_user?.phase).toBe('profile')
    expect(MEMORY_FACETS.facts?.phase).toBe('log')
    expect(MEMORY_FACETS.tasks?.phase).toBe('note')

    // A disabled plugin mounts nothing at all, rather than mounting a tool the
    // model can call but that writes nowhere.
    const { ctx, tools, sections } = recordingContext()
    await apply(ctx, { root, enabled: false })
    expect(tools).toEqual([])
    expect(sections).toEqual([])
  })
})

/* ──────────────────────────────────────────────────────────────────────────────
 * Write protocol: profile / log / note + Principle C flag
 * ────────────────────────────────────────────────────────────────────────────── */

describe('abaco-memory write protocol', () => {
  it('persists profile and project (log) facets unchanged before compact', async () => {
    const root = await memoryRoot()
    const store = new MemoryStore({ root })
    await store.load()
    await store.set({
      path: 'preferences_user.pref-lang.text',
      value: 'reporta siempre en español',
      source: 'user',
      ambient: AMBIENT
    })
    await store.set({
      path: 'decisions[+]',
      value: 'sidecar only — never a session event',
      source: 'agent:tool',
      ambient: AMBIENT
    })
    const facetsOf = (instance: MemoryStore, kind: string) =>
      JSON.stringify(instance.snapshot(AMBIENT).find((document) => document.kind === kind)?.facets)
    const profileFacets = facetsOf(store, 'profile')
    const projectFacets = facetsOf(store, 'project')
    const flush = await store.persistBeforeCompact(AMBIENT)
    expect(flush.ok).toBe(true)
    expect(flush.persisted.some((row) => row.kind === 'profile')).toBe(true)
    expect(flush.persisted.some((row) => row.kind === 'project')).toBe(true)
    expect(facetsOf(store, 'profile')).toBe(profileFacets)
    expect(facetsOf(store, 'project')).toBe(projectFacets)

    const reopened = new MemoryStore({ root })
    await reopened.load()
    expect(facetsOf(reopened, 'profile')).toBe(profileFacets)
    expect(facetsOf(reopened, 'project')).toBe(projectFacets)
  })

  it('refuses a subagent write to the parent profile, and stamps log writes', async () => {
    const root = await memoryRoot()
    const { ctx, tools } = recordingContext()
    await apply(ctx, { root })
    const setTool = toolNamed(tools, 'abaco_memory_set')
    const childExec: ToolExec = {
      agent: {
        session: {
          header: { ...HEADER, origin: 'subagent', delegationDepth: 1 }
        }
      }
    }

    await expect(
      setTool.execute({ key: 'preferences_user.pref-lang.text', value: 'no', source: 'user' }, childExec)
    ).rejects.toMatchObject({ code: 'MEMORY_SUBAGENT_PROFILE' })

    const logged = await setTool.execute({ key: 'facts[+]', value: 'child verified the path' }, childExec)
    expect(logged).toMatchObject({ ok: true, facet: 'facts', scope: 'project' })
    const store = new MemoryStore({ root })
    await store.load()
    const facts = await store.get({ path: 'facts', ambient: AMBIENT })
    expect(facts.facets[0]?.entries[0]?.source).toMatch(/^subagent:/)
    expect(facts.facets[0]?.entries[0]?.text).toBe('child verified the path')
  })

  it('keeps the Principle C flag on the session document across a reload', async () => {
    const root = await memoryRoot()
    const store = new MemoryStore({ root })
    await store.load()
    expect(await store.readConsent(AMBIENT)).toEqual({ state: 'unset', armed: true })
    expect(await store.writeConsent(AMBIENT, { state: 'allowed', armed: true })).toEqual({
      state: 'allowed',
      armed: true
    })
    const reopened = new MemoryStore({ root })
    await reopened.load()
    expect(await reopened.readConsent(AMBIENT)).toEqual({ state: 'allowed', armed: true })
    const document = await reopened.ensure('session', AMBIENT.sessionId as string)
    expect(document.meta.compactionConsent).toEqual({ state: 'allowed', armed: true })
  })

  it('does not inject the session meta/note facet into the prompt', async () => {
    const root = await memoryRoot()
    const store = new MemoryStore({ root })
    await store.load()
    await store.set({
      path: 'note',
      value: { text: 'working-state-must-not-eat-budget' },
      source: 'plugin:compaction',
      ambient: AMBIENT
    })
    const renderer = new MemoryRenderer({ store, config: resolveMemoryConfig({ root }) })
    expect(renderer.sectionText(promptContext())).not.toContain('working-state-must-not-eat-budget')
    const listed = await store.list({ ambient: AMBIENT })
    expect(listed.rows.every((row) => row.facet !== 'meta')).toBe(true)
    const got = await store.get({ path: 'meta', ambient: AMBIENT })
    expect(got.facets[0]?.record).toMatchObject({ text: 'working-state-must-not-eat-budget' })
  })
})
