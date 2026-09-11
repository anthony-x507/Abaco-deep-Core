import { existsSync } from 'node:fs'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { createScope, scopeTarget } from '@deepseek-ai/dsh-scope'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as vault from '../packages/abaco-vault/index.js'
import {
  apply,
  artifactFileName,
  composeVaultedText,
  Config,
  DEFAULT_VAULT_INLINE_CHARS,
  effectiveVaultRoot,
  flattenPlainText,
  inject,
  MEMORY_DIR_NAME,
  name,
  capSettlementOutput,
  planSettledRewrite,
  renderOmittedNotice,
  resolveVaultConfig,
  resolveVaultRoot,
  settledMessageText,
  slugify,
  utf8Bytes,
  VAULT_DIR_NAME,
  VAULT_INDEX_FILE,
  type HomePathFn
} from '../packages/abaco-vault/index.js'

/**
 * Layer 3 (`abaco-vault`) contract.
 *
 * These tests drive the shipped code path, not a re-implementation of it: `apply`
 * is mounted against a minimal recording context, the two listeners are invoked
 * exactly the way the harness invokes them (`agent/pre-step` with the fused
 * `agent` field, `tools/post-execute` with `(exec, result, next)`), and every
 * assertion afterwards is made against real files under a temporary vault root.
 *
 * The invariants worth restating, because everything else follows from them:
 *
 * - **The artifact is the full text, byte for byte.** Whatever the model sees
 *   afterwards, the vault holds `sha256(text)` and the exact byte count.
 * - **Nothing about a message we do not understand changes.** An unrecognized
 *   shape must come back as the *same object*, never as a guess.
 * - **A vault failure is not a tool failure.** A successful call must not turn
 *   into an error, and an oversized notice must stay inline rather than vanish.
 */

/* ──────────────────────────────────────────────────────────────────────────────
 * Fixtures
 * ────────────────────────────────────────────────────────────────────────────── */

const temporaryDirectories: string[] = []

/** The `$DSH_HOME` observed before the current test replaced it. */
let originalDshHome: string | undefined

// Safety net: every test that does not pass an explicit `root` must land in a
// temporary harness home. Without this, one wrong path in this suite would
// write artifacts into the developer's real `<DSH_HOME>/abaco-memory/`.
beforeEach(async () => {
  originalDshHome = process.env.DSH_HOME
  process.env.DSH_HOME = await temporaryDirectory()
})

/** A fresh directory, removed after the test. */
async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'abaco-vault-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  if (originalDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalDshHome
  originalDshHome = undefined
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

/** A `subagent-settled` notice, exactly as `dsh-subagent` builds it. */
function settledMessage(output: string, senderSessionId = 'child-session-1'): Record<string, unknown> {
  return {
    id: 'message-1',
    timestamp: '2026-01-01T00:00:00.000Z',
    content: [
      { type: 'text', text: `Subagent "${senderSessionId}" settled.` },
      { type: 'text', text: 'Its closing message:' },
      { type: 'text', text: output }
    ],
    source: { kind: 'subagent-settled', form: 'notice', summary: 'settled', senderSessionId }
  }
}

/** A long, line-oriented report: `lines` lines of `width` characters each. */
function report(lines: number, width = 80): string {
  return Array.from({ length: lines }, (_, index) => `linea-${index} ${'x'.repeat(Math.max(0, width - 12))}`).join('\n')
}

/** The recorded listener for one event name. */
interface Recorder {
  listeners: Array<{ name: string; listener: (...args: unknown[]) => unknown; options: unknown }>
  warnings: string[]
  ctx: Record<string, unknown>
}

/** The real Cordis event bus, viewed through the shape the harness dispatches. */
interface ScopedBus {
  waterfall(target: unknown, name: string, ...args: unknown[]): unknown
}

/** A minimal Cordis-shaped context that records listeners instead of running them. */
function recordingContext(): Recorder {
  const listeners: Recorder['listeners'] = []
  const warnings: string[] = []
  return {
    listeners,
    warnings,
    ctx: {
      on: (eventName: string, listener: (...args: unknown[]) => unknown, options: unknown) => {
        listeners.push({ name: eventName, listener, options })
        return () => {}
      },
      logger: {
        info: () => {},
        warn: (message: string) => warnings.push(message),
        error: () => {}
      }
    }
  }
}

/** Mount the plugin and return the recorder plus the pre-step listener. */
async function mountPreStep(config: unknown): Promise<{ recorder: Recorder; preStep: (...args: unknown[]) => Promise<unknown> }> {
  const recorder = recordingContext()
  await apply(recorder.ctx, config)
  const entry = recorder.listeners.find((candidate) => candidate.name === 'agent/pre-step')
  if (entry === undefined) throw new Error('agent/pre-step listener was not registered')
  return { recorder, preStep: entry.listener as (...args: unknown[]) => Promise<unknown> }
}

/** Mount the plugin and return the recorder plus the post-execute listener. */
async function mountPostExecute(config: unknown): Promise<{ recorder: Recorder; postExecute: (...args: unknown[]) => Promise<unknown> }> {
  const recorder = recordingContext()
  await apply(recorder.ctx, config)
  const entry = recorder.listeners.find((candidate) => candidate.name === 'tools/post-execute')
  if (entry === undefined) throw new Error('tools/post-execute listener was not registered')
  return { recorder, postExecute: entry.listener as (...args: unknown[]) => Promise<unknown> }
}

/** Call the pre-step listener with one proposed message list. */
async function runPreStep(
  listener: (...args: unknown[]) => Promise<unknown>,
  messages: unknown[],
  sessionId = 'parent-session-1'
): Promise<any> {
  return await listener({ agent: { session: { header: { id: sessionId } } }, turn: 1, step: 1 }, () => Promise.resolve({ kind: 'enter', messages }))
}

/* ──────────────────────────────────────────────────────────────────────────────
 * Pure planning
 * ────────────────────────────────────────────────────────────────────────────── */

describe('abaco-vault / pure planning', () => {
  it('renders the recovery line in the stock spill shape', () => {
    expect(renderOmittedNotice(4312, '/tmp/vault/session-1/1-report.txt')).toBe(
      '(se omitieron 4312 bytes. Resultado completo en: /tmp/vault/session-1/1-report.txt. Usa read con offset/limit o grep sobre esa ruta.)'
    )
    expect(renderOmittedNotice(-5, '/x')).toContain('se omitieron 0 bytes')
  })

  it('names artifacts `<epochMs>-<slug>.txt` and folds the slug safely', () => {
    expect(artifactFileName('session-1', 1700000000000, 'Informe Ejecutivo: ñandú')).toBe('1700000000000-informe-ejecutivo-nandu.txt')
    // No usable slug ⇒ the session id is the label; nothing at all ⇒ `artifact`.
    expect(artifactFileName('session-1', 42, '')).toBe('42-session-1.txt')
    expect(artifactFileName('', 42, '')).toBe('42-artifact.txt')
    expect(artifactFileName('s', Number.NaN, 'x')).toBe('0-x.txt')
    expect(slugify('a/b\\c d', 'fallback')).toBe('a-b-c-d')
  })

  it('keeps text at or below the threshold, and cuts text above it', () => {
    const small = report(5)
    expect(planSettledRewrite(small, { maxSettledBytes: 12000, headLines: 20 })).toEqual({
      kind: 'keep',
      reason: 'under-threshold',
      bytes: utf8Bytes(small)
    })
    expect(planSettledRewrite('', { maxSettledBytes: 10, headLines: 20 }).kind).toBe('keep')
    expect(planSettledRewrite(undefined as unknown as string, { maxSettledBytes: 10, headLines: 20 }).kind).toBe('keep')
  })

  it('keeps exactly `headLines` lines and reports the omitted byte count', () => {
    const text = report(400)
    const plan = planSettledRewrite(text, { maxSettledBytes: 12000, headLines: 20 })
    if (plan.kind !== 'rewrite') throw new Error('expected a rewrite')
    expect(plan.head.split('\n')).toHaveLength(20)
    expect(plan.bytes).toBe(utf8Bytes(text))
    expect(plan.kept).toBe(utf8Bytes(plan.head))
    expect(plan.omitted).toBe(plan.bytes - plan.kept)
    expect(plan.omitted).toBeGreaterThan(0)
    // Every line of the head is a verbatim prefix line — no reflowing.
    expect(text.startsWith(plan.head)).toBe(true)
  })

  it('bounds the head by bytes too, so a single giant line is still cut', () => {
    const text = `one-giant-line ${'y'.repeat(200000)}`
    const plan = planSettledRewrite(text, { maxSettledBytes: 12000, headLines: 20 })
    if (plan.kind !== 'rewrite') throw new Error('expected a rewrite')
    expect(plan.kept).toBeLessThanOrEqual(6000)
    expect(plan.omitted).toBeGreaterThan(190000)
    expect(text.startsWith(plan.head)).toBe(true)
  })

  it('never splits a multi-byte character at the byte boundary', () => {
    const text = `cabeza ${'ñ'.repeat(20000)}`
    const plan = planSettledRewrite(text, { maxSettledBytes: 1000, headLines: 1 })
    if (plan.kind !== 'rewrite') throw new Error('expected a rewrite')
    expect(plan.head).not.toContain('\ufffd')
    expect(text.startsWith(plan.head)).toBe(true)
    expect(utf8Bytes(plan.head)).toBeLessThanOrEqual(500)
  })

  it('composes head, blank line and notice', () => {
    expect(composeVaultedText('head', 10, '/v/a.txt')).toBe('head\n\n(se omitieron 10 bytes. Resultado completo en: /v/a.txt. Usa read con offset/limit o grep sobre esa ruta.)')
    expect(composeVaultedText('', 10, '/v/a.txt').startsWith('(se omitieron')).toBe(true)
  })

  it('recognizes only all-text `subagent-settled` messages', () => {
    const message = settledMessage('hola')
    expect(settledMessageText(message)).toBe('Subagent "child-session-1" settled.\nIts closing message:\nhola')
    // Attribution is what makes it a settlement notice at all.
    expect(settledMessageText({ content: [{ type: 'text', text: 'x' }], source: { kind: 'user' } })).toBeUndefined()
    expect(settledMessageText({ content: [{ type: 'text', text: 'x' }] })).toBeUndefined()
    expect(settledMessageText({ content: [], source: { kind: 'subagent-settled' } })).toBeUndefined()
    expect(settledMessageText({ content: 'raw', source: { kind: 'subagent-settled' } })).toBeUndefined()
    // An unfamiliar block kind must not be guessed at.
    expect(settledMessageText({ content: [{ type: 'image' }], source: { kind: 'subagent-settled' } })).toBeUndefined()
    expect(settledMessageText({ content: [{ type: 'text', text: 7 }], source: { kind: 'subagent-settled' } })).toBeUndefined()
    expect(settledMessageText(null)).toBeUndefined()
    expect(settledMessageText('nope')).toBeUndefined()
  })

  it('flattens plain text with the stock policy rule', () => {
    expect(flattenPlainText([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }])).toBe('ab')
    expect(flattenPlainText([{ type: 'text', text: 'a' }, { type: 'image' }])).toBeUndefined()
    expect(flattenPlainText([])).toBeUndefined()
    expect(flattenPlainText(undefined)).toBeUndefined()
  })
})

/* ──────────────────────────────────────────────────────────────────────────────
 * Path resolution
 * ────────────────────────────────────────────────────────────────────────────── */

describe('abaco-vault / vault root', () => {
  it('prefers $DSH_HOME, mirroring `resolveDshHome`', () => {
    expect(resolveVaultRoot({ DSH_HOME: '/tmp/home' })).toBe(`/tmp/home/${MEMORY_DIR_NAME}/${VAULT_DIR_NAME}`)
    expect(resolveVaultRoot({ DSH_HOME: '  /tmp/home  ' })).toBe(`/tmp/home/${MEMORY_DIR_NAME}/${VAULT_DIR_NAME}`)
    // A blank override must never resolve to the working directory.
    expect(resolveVaultRoot({ DSH_HOME: '   ' }, () => `/from/helper/${MEMORY_DIR_NAME}/${VAULT_DIR_NAME}`)).toBe(
      `/from/helper/${MEMORY_DIR_NAME}/${VAULT_DIR_NAME}`
    )
  })

  it('falls back to the harness helper, then to ~/.dsh', () => {
    const calls: string[][] = []
    const helper = (...segments: string[]): string => {
      calls.push(segments)
      return join('/harness/home', ...segments)
    }
    expect(resolveVaultRoot({}, helper)).toBe(`/harness/home/${MEMORY_DIR_NAME}/${VAULT_DIR_NAME}`)
    expect(calls).toEqual([[MEMORY_DIR_NAME, VAULT_DIR_NAME]])
    // A helper that throws is ignored, not propagated: the vault still resolves.
    expect(
      resolveVaultRoot({}, () => {
        throw new Error('boom')
      })
    ).toMatch(new RegExp(`\\.dsh/${MEMORY_DIR_NAME}/${VAULT_DIR_NAME}$`))
    expect(resolveVaultRoot({}, 'not-a-function' as unknown as HomePathFn)).toMatch(
      new RegExp(`\\.dsh/${MEMORY_DIR_NAME}/${VAULT_DIR_NAME}$`)
    )
  })

  it('honours an explicit `root` as the Layer-2 directory', () => {
    const config = resolveVaultConfig({ root: '/tmp/memory' })
    expect(config.root).toBe('/tmp/memory')
    expect(effectiveVaultRoot(config, { DSH_HOME: '/tmp/ignored' })).toBe(`/tmp/memory/${VAULT_DIR_NAME}`)
  })

  it('normalizes a malformed config to the defaults instead of failing', () => {
    expect(resolveVaultConfig(undefined)).toEqual({
      root: undefined,
      enabled: true,
      maxSettledBytes: 12000,
      headLines: 20,
      vaultInlineChars: 12000,
      vaultToolResults: true
    })
    expect(resolveVaultConfig({ maxSettledBytes: -1, headLines: 'x', vaultInlineChars: 0 })).toEqual({
      root: undefined,
      enabled: true,
      maxSettledBytes: 12000,
      headLines: 20,
      vaultInlineChars: 12000,
      vaultToolResults: true
    })
    expect(resolveVaultConfig({ enabled: false, vaultToolResults: false }).enabled).toBe(false)
    expect(resolveVaultConfig({ maxSettledBytes: 500 }).maxSettledBytes).toBe(500)
  })

  it('exports a Config that the Cordis validator can never reject', () => {
    // `dsh-cordis` validates through `Config['~standard'].validate` and throws a
    // ValidationError on issues (`@deepseek-ai/cordis/lib/index.js:956-957`).
    for (const raw of [undefined, null, {}, { maxSettledBytes: 1 }, { maxSettledBytes: 'oops' }, { unknown: true }, 42]) {
      const result = Config['~standard'].validate(raw)
      expect(result.issues).toBeUndefined()
    }
    expect(resolveVaultConfig(Config['~standard'].validate({ maxSettledBytes: 4096 }).value).maxSettledBytes).toBe(4096)
    // A bad field degrades alone: it must not discard `root` with it, or a typo
    // would silently move every artifact to the default home.
    expect(Config['~standard'].validate({ root: '/tmp/memory', headLines: 'oops' }).value).toEqual({
      root: '/tmp/memory',
      enabled: true,
      maxSettledBytes: 12000,
      headLines: 20,
      vaultInlineChars: 12000,
      vaultToolResults: true
    })
  })

  it('declares the Cordis surface', () => {
    expect(name).toBe('abaco-vault')
    expect(inject).toEqual(['tools'])
    expect(DEFAULT_VAULT_INLINE_CHARS).toBe(12000)
  })
})

/* ──────────────────────────────────────────────────────────────────────────────
 * Arm A — the settlement-notice hole
 * ────────────────────────────────────────────────────────────────────────────── */

describe('abaco-vault / spill-fix: no early notifySettlement truncate', () => {
  it('destructive dsh-subagent capSettlementOutput patch is absent', () => {
    // Arquitecto FAIL: that patch truncated terminal.output BEFORE message creation,
    // so Arm A saw ≤12KB and planSettledRewrite=keep → no vault, no locator.
    const patchPath = join(process.cwd(), 'patches', '@deepseek-ai+dsh-subagent+0.1.2-rc.1.patch')
    expect(existsSync(patchPath)).toBe(false)
  })

  it('Arm A vaults FULL verbatim first, then caps window WITH locator (byte-identical)', async () => {
    const directory = await temporaryDirectory()
    const { preStep } = await mountPreStep({ root: directory, maxSettledBytes: 12000, headLines: 20 })
    // Distinctive payload >> 12KB so any pre-truncate would destroy the tail marker.
    const body = `HEAD-MARKER\n${'Y'.repeat(18000)}\nTAIL-MARKER-VAULT-MUST-KEEP`
    const message = settledMessage(body, 'child-session-1')
    const full = settledMessageText(message)
    expect(full).toBeTruthy()
    expect(utf8Bytes(full as string)).toBeGreaterThan(12000)
    const decision = await runPreStep(preStep, [message])
    const windowText = decision.messages[0].content[0].text as string
    expect(utf8Bytes(windowText)).toBeLessThan(utf8Bytes(full as string))
    expect(windowText).toContain('se omitieron')
    expect(windowText).toMatch(/Resultado completo en: .+\.txt/)
    expect(windowText).not.toContain('TAIL-MARKER-VAULT-MUST-KEEP')

    const outputDirectory = join(directory, VAULT_DIR_NAME, 'parent-session-1')
    const files = await readdir(outputDirectory)
    expect(files).toHaveLength(1)
    const locator = join(outputDirectory, files[0] as string)
    const artifact = await readFile(locator, 'utf8')
    expect(artifact).toBe(full)
    expect(artifact).toContain('TAIL-MARKER-VAULT-MUST-KEEP')
    expect(utf8Bytes(artifact)).toBe(utf8Bytes(full as string))
    expect(windowText).toContain(locator)
  })
})

describe('abaco-vault / capSettlementOutput gate (vault-first)', () => {

  it('gate >12KB: vault verbatim FULL before cap; parent message carries locator', async () => {
    const directory = await temporaryDirectory()
    const { preStep } = await mountPreStep({ root: directory })
    const output = report(500)
    const message = settledMessage(output)
    const full = settledMessageText(message) as string
    expect(utf8Bytes(full)).toBeGreaterThan(12000)

    // Mirror notifySettlement order: detect over-budget → needs-vault (no truncate) → vault → cap+locator
    const beforeVault = capSettlementOutput(full, { maxBytes: 12000 })
    expect(beforeVault.kind).toBe('needs-vault')
    if (beforeVault.kind !== 'needs-vault') throw new Error('expected needs-vault')
    expect(beforeVault.text).toBe(full)

    const decision = await runPreStep(preStep, [message])
    const text = decision.messages[0]?.content[0]?.text as string
    const outputDirectory = join(directory, VAULT_DIR_NAME, 'parent-session-1')
    const files = await readdir(outputDirectory)
    expect(files).toHaveLength(1)
    const locator = join(outputDirectory, files[0] as string)
    const artifact = await readFile(locator, 'utf8')
    expect(artifact).toBe(full)
    expect(text).toContain(locator)
    expect(text).toContain('se omitieron')
    expect(utf8Bytes(text)).toBeLessThan(utf8Bytes(full))
  })
  it('keeps blocks under the 12KB budget', () => {
    const blocks = [{ type: 'text' as const, text: 'corto' }]
    const result = capSettlementOutput(blocks, { maxBytes: 12000 })
    expect(result.kind).toBe('keep')
    expect(result.bytes).toBeLessThanOrEqual(12000)
  })

  it('refuses to truncate without a locator (needs-vault)', () => {
    const text = 'x'.repeat(20000)
    const result = capSettlementOutput(text, { maxBytes: 12000 })
    expect(result.kind).toBe('needs-vault')
    if (result.kind !== 'needs-vault') throw new Error('expected needs-vault')
    expect(result.bytes).toBeGreaterThan(12000)
    expect(result.text).toBe(text)
    // Original content must remain available for vaulting — no destructive cut.
    expect(result.blocks[0]?.text ?? result.text).toContain('x'.repeat(100))
  })

  it('caps only after a locator is supplied', () => {
    const text = ('line\n').repeat(4000)
    const locator = '/tmp/abaco-memory/vault/session/1-subagent-settled.txt'
    const gated = capSettlementOutput(text, { maxBytes: 12000 })
    expect(gated.kind).toBe('needs-vault')
    const capped = capSettlementOutput(text, { maxBytes: 12000, locator })
    expect(capped.kind).toBe('capped')
    if (capped.kind !== 'capped') throw new Error('expected capped')
    expect(capped.locator).toBe(locator)
    expect(capped.omitted).toBeGreaterThan(0)
    expect(capped.blocks[0]?.text).toContain(locator)
    expect(capped.blocks[0]?.text).toContain('se omitieron')
    expect(utf8Bytes(capped.blocks[0]?.text ?? '')).toBeLessThan(capped.bytes)
  })
})

describe('abaco-vault / arm A: subagent-settled notices', () => {
  it('vaults an oversized notice verbatim, indexes it, and keeps the head inline', async () => {
    const directory = await temporaryDirectory()
    const { preStep } = await mountPreStep({ root: directory })
    const output = report(400)
    const message = settledMessage(output)
    const decision = await runPreStep(preStep, [message])

    expect(decision.kind).toBe('enter')
    expect(decision.messages).toHaveLength(1)
    const rewritten = decision.messages[0]
    // Attribution survives untouched — the client's settlement card depends on it.
    expect(rewritten.source).toBe(message.source)
    expect(rewritten.id).toBe('message-1')
    expect(rewritten.content).toHaveLength(1)
    expect(rewritten.content[0].type).toBe('text')

    const text = rewritten.content[0].text as string
    const full = settledMessageText(message) as string
    // The full text is unchanged upstream of the vault.
    expect(full.endsWith(output)).toBe(true)
    const outputDirectory = join(directory, VAULT_DIR_NAME, 'parent-session-1')
    const files = await readdir(outputDirectory)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^\d+-subagent-settled-child-session-1\.txt$/)

    const locator = join(outputDirectory, files[0] as string)
    const artifact = await readFile(locator, 'utf8')
    // Byte-for-byte, including the two leading lines `dsh-subagent` composed.
    expect(artifact).toBe(full)
    expect(utf8Bytes(artifact)).toBe(utf8Bytes(full))
    expect(text.startsWith(artifact.split('\n').slice(0, 20).join('\n'))).toBe(true)
    expect(text).toContain(`(se omitieron ${utf8Bytes(full) - utf8Bytes(artifact.split('\n').slice(0, 20).join('\n'))} bytes. Resultado completo en: ${locator}. Usa read con offset/limit o grep sobre esa ruta.)`)

    // 0600 file inside a 0700 directory, exactly like the harness's own spill.
    expect((await stat(locator)).mode & 0o777).toBe(0o600)
    expect((await stat(outputDirectory)).mode & 0o777).toBe(0o700)

    const index = (await readFile(join(directory, VAULT_DIR_NAME, VAULT_INDEX_FILE), 'utf8')).trim().split('\n')
    expect(index).toHaveLength(1)
    const record = JSON.parse(index[0] as string)
    expect(record.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(record.sessionId).toBe('parent-session-1')
    expect(record.kind).toBe('subagent-settled')
    expect(record.bytes).toBe(utf8Bytes(full))
    expect(record.sha256).toBe(createHash('sha256').update(full, 'utf8').digest('hex'))
    expect(record.locator).toBe(locator)
    expect(record.senderSessionId).toBe('child-session-1')
    expect(Number.isNaN(Date.parse(record.createdAt))).toBe(false)
    // No temporary file was left behind by the atomic write.
    expect(files.some((file) => file.endsWith('.tmp'))).toBe(false)
  })

  it('resolves the vault from $DSH_HOME when no `root` is configured', async () => {
    const home = await temporaryDirectory()
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const { preStep } = await mountPreStep({})
      const decision = await runPreStep(preStep, [settledMessage(report(400))])
      expect(decision.messages[0].content[0].text).toContain(`${join(home, MEMORY_DIR_NAME, VAULT_DIR_NAME)}`)
      const files = await readdir(join(home, MEMORY_DIR_NAME, VAULT_DIR_NAME, 'parent-session-1'))
      expect(files).toHaveLength(1)
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })

  it('leaves short notices, real user messages and odd shapes untouched — same object', async () => {
    const directory = await temporaryDirectory()
    const { preStep } = await mountPreStep({ root: directory })
    const short = settledMessage('corto')
    const userMessage = { id: 'm2', content: [{ type: 'text', text: 'x'.repeat(50000) }], source: { kind: 'user' } }
    const imageOnly = { id: 'm3', content: [{ type: 'image' }], source: { kind: 'subagent-settled', senderSessionId: 'c' } }
    const noContent = { id: 'm4', source: { kind: 'subagent-settled', senderSessionId: 'c' } }
    const messages = [short, userMessage, imageOnly, noContent]
    const decision = await runPreStep(preStep, messages)

    expect(decision.messages[0]).toBe(short)
    expect(decision.messages[1]).toBe(userMessage)
    expect(decision.messages[2]).toBe(imageOnly)
    expect(decision.messages[3]).toBe(noContent)
    // Mounting created the vault root; nothing was written into it.
    expect(await readdir(join(directory, VAULT_DIR_NAME))).toEqual([])
  })

  it('returns a reject decision and an empty message list unchanged', async () => {
    const directory = await temporaryDirectory()
    const { preStep, recorder } = await mountPreStep({ root: directory })
    const rejected = { kind: 'reject', reason: 'blocked' }
    expect(await preStep({ agent: { session: { header: { id: 's' } } } }, () => Promise.resolve(rejected))).toBe(rejected)
    expect(await runPreStep(preStep, [])).toEqual({ kind: 'enter', messages: [] })
    expect(recorder.warnings).toEqual([])
  })

  it('keeps the notice inline when the vault cannot be written, and never throws', async () => {
    const directory = await temporaryDirectory()
    // A regular file where the memory directory should be ⇒ ENOTDIR on mkdir.
    const blocker = join(directory, 'blocker')
    await writeFile(blocker, 'not a directory')
    const { preStep, recorder } = await mountPreStep({ root: blocker })
    const message = settledMessage(report(400))
    const decision = await runPreStep(preStep, [message])

    expect(decision.messages[0]).toBe(message)
    expect(recorder.warnings.some((warning) => warning.includes('keeping it inline'))).toBe(true)
  })

  it('refuses to "rewrite" when the cut would not remove any bytes', async () => {
    const directory = await temporaryDirectory()
    // A threshold below the notice size, but a head budget that keeps all of it:
    // the plan answers `keep` rather than producing an identical replacement.
    const { preStep } = await mountPreStep({ root: directory, maxSettledBytes: 1, headLines: 1000 })
    const message = settledMessage('una linea')
    const decision = await runPreStep(preStep, [message])
    expect(decision.messages[0]).toBe(message)
  })
})

/* ──────────────────────────────────────────────────────────────────────────────
 * Arm B — durable copies of oversized tool results
 * ────────────────────────────────────────────────────────────────────────────── */

describe('abaco-vault / arm B: tool results', () => {
  const accept = (content: unknown): Record<string, unknown> => ({ kind: 'accept', content })

  it('vaults a large result without touching the decision the model sees', async () => {
    const directory = await temporaryDirectory()
    const { postExecute } = await mountPostExecute({ root: directory })
    const text = report(500)
    const decision = accept([{ type: 'text', text }])
    const returned = await postExecute(
      { name: 'bash', callId: 'call-1', agent: { session: { header: { id: 'parent-session-1' } } } },
      { content: [{ type: 'text', text }] },
      () => Promise.resolve(decision)
    )

    // Arm B adds durability only: the stock policy still owns the cut.
    expect(returned).toBe(decision)
    const outputDirectory = join(directory, VAULT_DIR_NAME, 'parent-session-1')
    const files = await readdir(outputDirectory)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^\d+-bash-call-1\.txt$/)
    const locator = join(outputDirectory, files[0] as string)
    expect(await readFile(locator, 'utf8')).toBe(text)
    const record = JSON.parse((await readFile(join(directory, VAULT_DIR_NAME, VAULT_INDEX_FILE), 'utf8')).trim())
    expect(record).toMatchObject({ kind: 'tool-result', tool: 'bash', callId: 'call-1', bytes: utf8Bytes(text), sessionId: 'parent-session-1' })
    expect(record.sha256).toBe(createHash('sha256').update(text, 'utf8').digest('hex'))
  })

  it('skips `read`, nested calls, small results and calls with no session', async () => {
    const directory = await temporaryDirectory()
    const { postExecute } = await mountPostExecute({ root: directory })
    const text = report(500)
    const content = [{ type: 'text', text }]
    const next = (): Promise<unknown> => Promise.resolve(accept(content))

    await postExecute({ name: 'read', callId: 'c', agent: { session: { header: { id: 's' } } } }, { content }, next)
    await postExecute({ name: 'bash', callId: 'c', parent: { name: 'run_code' }, agent: { session: { header: { id: 's' } } } }, { content }, next)
    await postExecute({ name: 'bash', callId: 'c', agent: { session: { header: { id: 's' } } } }, { content: [{ type: 'text', text: 'corto' }] }, next)
    await postExecute({ name: 'bash', callId: 'c' }, { content }, next)
    await postExecute({ name: 'bash', callId: 'c', agent: { session: { header: { id: 's' } } } }, { content: [{ type: 'image' }] }, next)

    expect(await readdir(join(directory, VAULT_DIR_NAME))).toEqual([])
  })

  it('never throws when the vault is unwritable, and always returns the next decision', async () => {
    const directory = await temporaryDirectory()
    const blocker = join(directory, 'blocker')
    await writeFile(blocker, 'not a directory')
    const { postExecute, recorder } = await mountPostExecute({ root: blocker })
    const text = report(500)
    const decision = accept([{ type: 'text', text }])
    const returned = await postExecute(
      { name: 'bash', callId: 'c', agent: { session: { header: { id: 's' } } } },
      { content: [{ type: 'text', text }] },
      () => Promise.resolve(decision)
    )
    expect(returned).toBe(decision)
    expect(recorder.warnings.some((warning) => warning.includes('keeping it inline'))).toBe(true)
  })

  it('honours `vaultToolResults: false` and `enabled: false`', async () => {
    const directory = await temporaryDirectory()
    const off = recordingContext()
    await apply(off.ctx, { root: directory, vaultToolResults: false })
    expect(off.listeners.map((entry) => entry.name)).toEqual(['agent/pre-step'])

    const disabled = recordingContext()
    await apply(disabled.ctx, { root: directory, enabled: false })
    expect(disabled.listeners).toEqual([])

    // Both arms register on the default config, both with the stock `prepend`.
    const on = recordingContext()
    await apply(on.ctx, { root: directory })
    expect(on.listeners.map((entry) => entry.name)).toEqual(['agent/pre-step', 'tools/post-execute'])
    expect(on.listeners.every((entry) => (entry.options as { prepend?: boolean }).prepend === true)).toBe(true)
  })

  it('writes two artifacts for two same-millisecond saves instead of overwriting', async () => {
    const directory = await temporaryDirectory()
    const { preStep } = await mountPreStep({ root: directory })
    const messages = [settledMessage(report(400), 'child-a'), settledMessage(report(400), 'child-b')]
    const decision = await runPreStep(preStep, messages)
    expect(decision.messages).toHaveLength(2)
    const files = await readdir(join(directory, VAULT_DIR_NAME, 'parent-session-1'))
    expect(files).toHaveLength(2)
    const index = (await readFile(join(directory, VAULT_DIR_NAME, VAULT_INDEX_FILE), 'utf8')).trim().split('\n')
    expect(index).toHaveLength(2)
  })
})

/* ──────────────────────────────────────────────────────────────────────────────
 * Mounting, routing and hygiene
 * ────────────────────────────────────────────────────────────────────────────── */

describe('abaco-vault / mounting', () => {
  it('mounts into a real cordis context and serves real agent-scoped dispatches', async () => {
    const directory = await temporaryDirectory()
    const ctx = new Context()
    const provide = ctx.provide.bind(ctx) as (service: string, value: unknown) => () => void
    provide('tools', {})

    // The real module namespace is mounted, so the exported `Config` is
    // validated by Cordis itself — the boot path that must never throw.
    await ctx.plugin(vault, { root: directory, maxSettledBytes: 4000, headLines: 6 })
    const bus = ctx as unknown as ScopedBus
    const agent = { session: { header: { id: 'real-session' } } }
    const target = scopeTarget(agent, agent)

    // `agent/pre-step` is dispatched with the agent fused into the payload
    // (`dsh-agent/lib/index.js:361-364`), exactly as here.
    const message = settledMessage(report(400))
    const decision = (await bus.waterfall(
      target,
      'agent/pre-step',
      { agent, messages: [message], turn: 1, step: 1, signal: undefined },
      () => Promise.resolve({ kind: 'enter', messages: [message] })
    )) as { kind: string; messages: Array<{ content: Array<{ text: string }>; source: unknown }> }
    expect(decision.kind).toBe('enter')
    expect(decision.messages[0]?.content[0]?.text).toContain('se omitieron')
    expect(decision.messages[0]?.source).toBe(message.source)

    // `tools/post-execute` is dispatched positionally as `(exec, result, next)`
    // (`dsh-tools/lib/index.js:3373`).
    const accepted = { kind: 'accept' }
    const returned = await bus.waterfall(
      target,
      'tools/post-execute',
      { name: 'bash', callId: 'call-9', agent },
      { content: [{ type: 'text', text: report(400) }] },
      () => Promise.resolve(accepted)
    )
    expect(returned).toBe(accepted)

    const files = await readdir(join(directory, VAULT_DIR_NAME, 'real-session'))
    expect(files).toHaveLength(2)
    expect(files.filter((file) => file.includes('subagent-settled'))).toHaveLength(1)
    expect(files.filter((file) => file.includes('bash-call-9'))).toHaveLength(1)

    // A listener minted inside one agent's scope sees only its own dispatches:
    // routing one agent's notices does not touch another's.
    const other = { session: { header: { id: 'other-session' } } }
    const scope = createScope(ctx, other)
    const scopedBus = scope.ctx as unknown as ScopedBus
    await scopedBus.waterfall(
      scopeTarget(other, other),
      'tools/post-execute',
      { name: 'grep', callId: 'call-10', agent: other },
      { content: [{ type: 'text', text: report(400) }] },
      () => Promise.resolve(accepted)
    )
    // The host-plane listener is admitted for descendants as well, which is what
    // lets one vault serve every agent; the scope's own artifacts stay separate.
    expect(await readdir(join(directory, VAULT_DIR_NAME, 'other-session'))).toHaveLength(1)
    await scope.dispose()
  })

  it('activates even when the row config is garbage, instead of failing the plugin tree', async () => {
    const home = await temporaryDirectory()
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const ctx = new Context()
      const provide = ctx.provide.bind(ctx) as (service: string, value: unknown) => () => void
      provide('tools', {})
      // A typo in one field degrades THAT field to its default — it neither
      // fails the row with a ValidationError (`@deepseek-ai/cordis/lib/index.js:956-959`)
      // nor discards its valid siblings, `root` above all.
      await ctx.plugin(vault, { maxSettledBytes: 'doce mil', headLines: -3, vaultInlineChars: null })
      const bus = ctx as unknown as ScopedBus
      const agent = { session: { header: { id: 'garbage-config' } } }
      const message = settledMessage(report(400))
      const decision = (await bus.waterfall(
        scopeTarget(agent, agent),
        'agent/pre-step',
        { agent, messages: [message], turn: 1, step: 1, signal: undefined },
        () => Promise.resolve({ kind: 'enter', messages: [message] })
      )) as { messages: Array<{ content: Array<{ text: string }> }> }
      // Default maxSettledBytes (12000) still applies, so the notice is rewritten.
      expect(decision.messages[0]?.content[0]?.text).toContain('se omitieron')
      // And with no valid `root`, the vault derived itself from $DSH_HOME.
      expect(await readdir(join(home, MEMORY_DIR_NAME, VAULT_DIR_NAME, 'garbage-config'))).toHaveLength(1)
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })

  it('reads only the services it declares, assigns nothing onto ctx, and writes no session event', async () => {
    const files = ['index.js', 'lib/plan.js']
    const sources = await Promise.all(files.map((file) => readFile(`packages/abaco-vault/${file}`, 'utf8')))
    const source = sources[0] as string
    const manifest = JSON.parse(await readFile('packages/abaco-vault/package.json', 'utf8')) as {
      name: string
      version: string
      type: string
      main: string
      exports: Record<string, unknown>
      dependencies: Record<string, string>
      peerDependencies: Record<string, string>
      dsh?: unknown
    }

    expect(manifest.name).toBe('abaco-vault')
    expect(manifest.version).toBe('0.1.0')
    expect(manifest.type).toBe('module')
    expect(manifest.main).toBe('./index.js')
    expect(manifest.exports['.']).toBeDefined()
    expect(manifest.exports['./package.json']).toBeDefined()
    // A host-only plugin must not advertise a client half.
    expect(manifest.dsh).toBeUndefined()
    expect(manifest.dependencies.zod).toBeDefined()
    expect(manifest.peerDependencies['@deepseek-ai/cordis']).toBeDefined()
    expect(source).toContain("export const name = 'abaco-vault'")
    expect(source).toContain("export const inject = ['tools']")

    // Comments talk about `ctx` at length, so the assertion runs on code with
    // them stripped: outside a comment, the only members reachable through
    // `ctx` are the event bus and the built-in logger, and nothing is ever
    // *assigned* onto it — which is what breaks the Cordis tree.
    const code = sources
      .join('\n')
      .replace(/\/\*[\s\S]*?\*\//gu, '')
      .replace(/^\s*\/\/.*$/gmu, '')
    const touched = [...code.matchAll(/\bctx\??\.([A-Za-z_$][\w$]*)/gu)].map((match) => match[1])
    expect([...new Set(touched)].sort()).toEqual(['logger', 'on'])
    expect(code).not.toMatch(/ctx\??\.[A-Za-z_$][\w$]*\s*=(?!=)/u)
    // The prohibited persistence path: the log's vocabulary is closed, so a
    // vault event would produce a session this harness refuses to reopen.
    expect(code).not.toContain('session.append')
    expect(code).not.toContain('.append("abaco')
    expect(code).not.toContain(".append('abaco")
  })
})
