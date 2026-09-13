import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ABACO_BROWSER_RECORD_MAX_ACTIONS,
  ABACO_BROWSER_RECORD_MAX_TEXT,
  ABACO_BROWSER_RECORD_PREFIX,
  ABACO_BROWSER_REDACTED_VALUE,
  ABACO_BROWSER_RECORDING_SCHEMA,
  ABACO_BROWSER_SENSITIVE_AUTOCOMPLETE,
  ABACO_BROWSER_SENSITIVE_FIELD_TOKENS,
  ABACO_BROWSER_THEME_CHANGED_CHANNEL,
  abacoBrowserChannels,
  abacoBrowserShortcutFor,
  abacoBrowserShortcuts,
  isAbacoBrowserRecordedActionType,
  isAbacoBrowserShortcut,
  isSensitiveBrowserField,
  normalizeBrowserFieldToken,
  shouldRedactBrowserValue,
  type AbacoBrowserRecordedAction,
  type AbacoBrowserRecordedField,
  type AbacoBrowserRecordingDocument
} from '../src/shared/abaco-browser'
import {
  AbacoBrowserRecorder,
  decodeAbacoRecordedMessage,
  mergeRecordedAction,
  type AbacoBrowserRecorderPort
} from '../src/main/abaco-browser-recorder'
import { installRecorderInPage, uninstallRecorderInPage } from '../src/main/abaco-browser-page-scripts'

/* ──────────────────────────────────────────────────────────────────────────────
 * F2 — the decoder
 *
 * F0/F1 shipped a page half that emitted `console.log('__ABACO_REC__', json)`
 * and no consumer for it, so no user action was ever recorded. These tests pin
 * the consumer: the parse, the redaction and the merge policy are what turn that
 * stream into a file F3 can build a skill from.
 * ────────────────────────────────────────────────────────────────────────────── */

/** One line as the page script emits it: prefix, a space, then the JSON. */
function wire(payload: unknown): string {
  return `${ABACO_BROWSER_RECORD_PREFIX} ${JSON.stringify(payload)}`
}

function field(overrides: Partial<AbacoBrowserRecordedField> = {}): AbacoBrowserRecordedField {
  return { tag: 'input', type: 'text', name: '', id: '', autocomplete: '', ...overrides }
}

function action(overrides: Partial<AbacoBrowserRecordedAction> = {}): AbacoBrowserRecordedAction {
  return {
    timestamp: '2026-09-06T10:00:00.000Z',
    url: 'https://example.com/',
    action_type: 'click',
    ...overrides
  }
}

describe('ABACO browser recorder decoder (F2)', () => {
  it('decodes a well-formed page message into a recorded action', () => {
    const decoded = decodeAbacoRecordedMessage(
      wire({
        ts: '2026-09-06T10:00:01.000Z',
        url: 'https://example.com/login',
        action_type: 'click',
        selector: '#submit',
        text: 'Sign in',
        notes: 'submit',
        field: field({ type: 'submit' }),
        sensitive: false
      })
    )

    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.redacted).toBe(false)
    expect(decoded.action).toEqual({
      timestamp: '2026-09-06T10:00:01.000Z',
      url: 'https://example.com/login',
      action_type: 'click',
      selector: '#submit',
      text: 'Sign in',
      notes: 'submit',
      field: field({ type: 'submit' })
    })
  })

  it('refuses invalid JSON, a non-object, an unknown action and unrelated console lines', () => {
    // The three refusals that are *not* the page's fault still have to be
    // distinguishable: a page can call `console.log` for its own reasons, and
    // only the middle two are evidence of a broken recorder.
    expect(decodeAbacoRecordedMessage('just a log line')).toEqual({
      ok: false,
      reason: 'no-prefix'
    })
    expect(decodeAbacoRecordedMessage(`${ABACO_BROWSER_RECORD_PREFIX} `)).toEqual({
      ok: false,
      reason: 'malformed-json'
    })
    expect(decodeAbacoRecordedMessage(wire({ action_type: 'click' }).slice(0, -3))).toEqual({
      ok: false,
      reason: 'malformed-json'
    })
    expect(decodeAbacoRecordedMessage(wire([1, 2, 3]))).toEqual({
      ok: false,
      reason: 'not-an-object'
    })
    expect(decodeAbacoRecordedMessage(wire({ action_type: 'exfiltrate' }))).toEqual({
      ok: false,
      reason: 'unknown-action'
    })
    expect(decodeAbacoRecordedMessage(wire({}))).toEqual({ ok: false, reason: 'unknown-action' })
    // A truncated message must not throw: this runs on every console message of
    // every browsed page.
    expect(() => decodeAbacoRecordedMessage(null as unknown as string)).toThrow()
  })

  it('finds the prefix even when the platform prepends the source location', () => {
    const decoded = decodeAbacoRecordedMessage(
      `https://example.com/app.js:12 ${wire({ url: 'https://example.com/', action_type: 'scroll', notes: 'y=10' }).trim()}`
    )
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.action.action_type).toBe('scroll')
  })

  it('falls back to the live URL and to main s clock when the page omits them', () => {
    const decoded = decodeAbacoRecordedMessage(wire({ action_type: 'click' }), {
      fallbackUrl: 'https://example.com/here'
    })
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.action.url).toBe('https://example.com/here')
    expect(Number.isNaN(Date.parse(decoded.action.timestamp))).toBe(false)

    const bogus = decodeAbacoRecordedMessage(wire({ action_type: 'click', ts: 'not-a-date', url: 42 }), {
      fallbackUrl: 'https://example.com/here'
    })
    expect(bogus.ok).toBe(true)
    if (!bogus.ok) return
    expect(bogus.action.url).toBe('https://example.com/here')
    expect(Number.isNaN(Date.parse(bogus.action.timestamp))).toBe(false)
  })

  it('clamps oversized text and selectors instead of writing them to the file', () => {
    const decoded = decodeAbacoRecordedMessage(
      wire({
        action_type: 'type',
        selector: 'x'.repeat(2000),
        text: 'y'.repeat(ABACO_BROWSER_RECORD_MAX_TEXT + 100)
      })
    )
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.action.selector?.length).toBeLessThanOrEqual(501)
    expect(decoded.action.text?.length).toBeLessThanOrEqual(ABACO_BROWSER_RECORD_MAX_TEXT + 1)
  })

  it('only accepts the recorded action vocabulary', () => {
    for (const type of ['click', 'type', 'navigate', 'scroll', 'screenshot', 'wait']) {
      expect(isAbacoBrowserRecordedActionType(type)).toBe(true)
    }
    expect(isAbacoBrowserRecordedActionType('exec')).toBe(false)
    expect(isAbacoBrowserRecordedActionType(7)).toBe(false)
  })
})

/* ──────────────────────────────────────────────────────────────────────────────
 * F2 — redaction
 * ────────────────────────────────────────────────────────────────────────────── */

describe('ABACO browser recorder redaction (F2)', () => {
  it('never records the value of a password field', () => {
    const decoded = decodeAbacoRecordedMessage(
      wire({
        action_type: 'type',
        selector: '#password',
        text: 'hunter2',
        notes: 'password',
        field: field({ type: 'password', name: 'password', id: 'password' })
      })
    )
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.redacted).toBe(true)
    expect(decoded.action.text).toBe(ABACO_BROWSER_REDACTED_VALUE)
    expect(JSON.stringify(decoded.action)).not.toContain('hunter2')
  })

  it('masks a value the page claimed was safe, when the metadata says otherwise', () => {
    // The page script is the *first* layer, not the authority: a page that lies
    // with `sensitive: false` still gets its password masked, because main
    // re-derives the verdict from the element metadata the page attached.
    const decoded = decodeAbacoRecordedMessage(
      wire({
        action_type: 'type',
        selector: '#pw',
        text: 'correct horse battery staple',
        sensitive: false,
        field: field({ type: 'password' })
      })
    )
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.redacted).toBe(true)
    expect(decoded.action.text).toBe(ABACO_BROWSER_REDACTED_VALUE)
  })

  it('masks card, one-time-code and unlabelled-credential fields', () => {
    const cases: Partial<AbacoBrowserRecordedField>[] = [
      { type: 'text', autocomplete: 'cc-number', name: 'card' },
      { type: 'text', autocomplete: 'cc-csc', name: 'cvc' },
      { type: 'text', autocomplete: 'current-password', name: 'user' },
      { type: 'text', autocomplete: 'new-password', name: 'user' },
      { type: 'text', autocomplete: 'one-time-code', name: 'code' },
      { type: 'text', name: 'user_password' },
      { type: 'text', name: 'userPassword' },
      { type: 'text', id: 'api_token' },
      { type: 'text', name: 'cvv2' },
      { type: 'text', name: 'iban' },
      { type: 'text', name: 'ssn' }
    ]
    for (const overrides of cases) {
      const decoded = decodeAbacoRecordedMessage(
        wire({ action_type: 'type', text: 'SECRET-VALUE', field: field(overrides) })
      )
      expect(decoded.ok).toBe(true)
      if (!decoded.ok) continue
      expect(decoded.action.text, JSON.stringify(overrides)).toBe(ABACO_BROWSER_REDACTED_VALUE)
      expect(decoded.redacted, JSON.stringify(overrides)).toBe(true)
    }
  })

  it('keeps ordinary values, including a search box and a form label', () => {
    const decoded = decodeAbacoRecordedMessage(
      wire({
        action_type: 'type',
        selector: '#q',
        text: 'abaco deep harness',
        field: field({ name: 'q', autocomplete: 'off' })
      })
    )
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.redacted).toBe(false)
    expect(decoded.action.text).toBe('abaco deep harness')
    expect(shouldRedactBrowserValue({ field: field({ name: 'q' }) })).toBe(false)
    expect(isSensitiveBrowserField(undefined)).toBe(false)
  })

  it('treats a redacted note as a redaction signal on its own', () => {
    // The page's own marker survives even if it sent no field metadata at all.
    expect(shouldRedactBrowserValue({ notes: 'redacted:password' })).toBe(true)
    expect(shouldRedactBrowserValue({ notes: 'password' })).toBe(true)
    expect(shouldRedactBrowserValue({ sensitive: true })).toBe(true)
    expect(shouldRedactBrowserValue({ notes: 'text' })).toBe(false)
  })

  it('normalizes field names the way forms actually spell them', () => {
    expect(normalizeBrowserFieldToken('userPassword')).toBe('user-password')
    expect(normalizeBrowserFieldToken('user_password')).toBe('user-password')
    expect(normalizeBrowserFieldToken('  Card Number ')).toBe('card-number')
    expect(normalizeBrowserFieldToken('')).toBe('')
    // The token lists are the published contract of the page script too.
    expect(ABACO_BROWSER_SENSITIVE_FIELD_TOKENS).toContain('password')
    expect(ABACO_BROWSER_SENSITIVE_FIELD_TOKENS).toContain('cvv')
    expect(ABACO_BROWSER_SENSITIVE_AUTOCOMPLETE).toContain('cc-number')
  })
})

/* ──────────────────────────────────────────────────────────────────────────────
 * F2 — merge policy
 * ────────────────────────────────────────────────────────────────────────────── */

describe('ABACO browser recorder merge policy (F2)', () => {
  it('collapses a typed word into one step, keeping the finished value', () => {
    const first = action({
      action_type: 'type',
      selector: '#q',
      text: 'a',
      timestamp: '2026-09-06T10:00:00.000Z'
    })
    const second = action({
      action_type: 'type',
      selector: '#q',
      text: 'abaco',
      timestamp: '2026-09-06T10:00:00.400Z'
    })
    const merged = mergeRecordedAction(first, second)
    expect(merged.kind).toBe('replace')
    if (merged.kind !== 'replace') return
    expect(merged.action.text).toBe('abaco')
    // The step's time is when the user started on the field.
    expect(merged.action.timestamp).toBe(first.timestamp)
  })

  it('starts a new step after a pause, on another field, or on another page', () => {
    const base = action({ action_type: 'type', selector: '#q', text: 'abaco' })
    expect(
      mergeRecordedAction(base, {
        ...base,
        text: 'abaco deep',
        timestamp: '2026-09-06T10:00:05.000Z'
      }).kind
    ).toBe('append')
    expect(
      mergeRecordedAction(base, {
        ...base,
        selector: '#other',
        timestamp: '2026-09-06T10:00:00.200Z'
      }).kind
    ).toBe('append')
    expect(
      mergeRecordedAction(base, {
        ...base,
        url: 'https://example.com/next',
        timestamp: '2026-09-06T10:00:00.200Z'
      }).kind
    ).toBe('append')
    expect(mergeRecordedAction(undefined, base).kind).toBe('append')
    expect(mergeRecordedAction(base, { ...base, action_type: 'click' }).kind).toBe('append')
  })

  it('keeps a field redacted once it has been redacted', () => {
    const first = action({
      action_type: 'type',
      selector: '#pw',
      text: ABACO_BROWSER_REDACTED_VALUE,
      redacted: true
    })
    const merged = mergeRecordedAction(first, {
      ...first,
      text: ABACO_BROWSER_REDACTED_VALUE,
      redacted: undefined,
      timestamp: '2026-09-06T10:00:00.300Z'
    })
    expect(merged.kind).toBe('replace')
    if (merged.kind !== 'replace') return
    expect(merged.action.redacted).toBe(true)
  })

  it('collapses the will-navigate/did-navigate pair into one step that keeps the title', () => {
    const intent = action({
      action_type: 'navigate',
      timestamp: '2026-09-06T10:00:00.000Z',
      notes: 'will-navigate'
    })
    const arrival = action({
      action_type: 'navigate',
      timestamp: '2026-09-06T10:00:01.500Z',
      notes: 'title="Example Domain"'
    })
    const merged = mergeRecordedAction(intent, arrival)
    expect(merged.kind).toBe('replace')
    if (merged.kind !== 'replace') return
    expect(merged.action.notes).toBe('title="Example Domain" | will-navigate')
    expect(merged.action.timestamp).toBe(intent.timestamp)
    // Same URL five seconds later is a real second visit, not the same trip.
    expect(
      mergeRecordedAction(intent, { ...arrival, timestamp: '2026-09-06T10:00:09.000Z' }).kind
    ).toBe('append')
  })

  it('drops the momentum of a scroll but keeps the first position', () => {
    const first = action({ action_type: 'scroll', notes: 'y=100', timestamp: '2026-09-06T10:00:00.000Z' })
    const next = action({ action_type: 'scroll', notes: 'y=140', timestamp: '2026-09-06T10:00:00.500Z' })
    expect(mergeRecordedAction(first, next).kind).toBe('drop')
    expect(
      mergeRecordedAction(first, { ...next, timestamp: '2026-09-06T10:00:03.000Z' }).kind
    ).toBe('append')
  })

  it('appends rather than guessing when a timestamp is unusable', () => {
    const broken = action({ timestamp: 'nonsense' })
    expect(mergeRecordedAction(broken, { ...broken }).kind).toBe('append')
    // A clock that went backwards must not merge unrelated steps either.
    expect(
      mergeRecordedAction(action({ timestamp: '2026-09-06T10:00:05.000Z' }), broken).kind
    ).toBe('append')
  })
})

/* ──────────────────────────────────────────────────────────────────────────────
 * F2 — a whole recording, on a real disk
 * ────────────────────────────────────────────────────────────────────────────── */

interface FakePort {
  port: AbacoBrowserRecorderPort
  evaluated: string[]
  page: { url: string; title: string }
  setPng: (value: Buffer | undefined) => void
}

function fakePort(): FakePort {
  const evaluated: string[] = []
  const page = { url: 'https://example.com/login', title: 'Sign in' }
  let png: Buffer | undefined = Buffer.from('fake-png-bytes')
  return {
    evaluated,
    page,
    setPng: (value) => {
      png = value
    },
    port: {
      pageInfo: () => ({ ...page }),
      evaluate: async (source: string) => {
        evaluated.push(source)
        return true
      },
      capturePng: async () => png
    }
  }
}

const temporaryDirectories: string[] = []

async function tempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'abaco-recorder-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('ABACO browser recorder session (F2)', () => {
  it('drives a whole recording: decode, redact, merge, persist with screenshots', async () => {
    const directory = await tempDir()
    const fake = fakePort()
    let clock = Date.parse('2026-09-06T10:00:00.000Z')
    const recorder = new AbacoBrowserRecorder({
      port: fake.port,
      outputDir: directory,
      now: () => new Date(clock),
      log: () => {}
    })

    expect(recorder.isRecording()).toBe(false)
    expect(recorder.status().recording).toBe(false)

    const started = await recorder.start('manual')
    expect(started.recording).toBe(true)
    expect(started.sessionId).toBe('2026-09-06T10-00-00-000Z')
    // The page half really was injected, with the prefix it must emit.
    expect(fake.evaluated).toHaveLength(1)
    expect(fake.evaluated[0]).toContain(ABACO_BROWSER_RECORD_PREFIX)
    expect(fake.evaluated[0]).toContain('isTrusted')

    // Ordinary page noise, a broken message, then the user's actual session.
    recorder.consumeConsoleMessage('[vite] connected')
    recorder.consumeConsoleMessage(`${ABACO_BROWSER_RECORD_PREFIX} {oops`)
    recorder.consumeConsoleMessage(
      wire({
        ts: '2026-09-06T10:00:01.000Z',
        url: fake.page.url,
        action_type: 'type',
        selector: '#user',
        text: 'ada@example.com',
        field: field({ name: 'user' })
      })
    )
    clock += 300
    recorder.consumeConsoleMessage(
      wire({
        ts: '2026-09-06T10:00:01.300Z',
        url: fake.page.url,
        action_type: 'type',
        selector: '#user',
        text: 'ada@example.com',
        field: field({ name: 'user' })
      })
    )
    clock += 300
    recorder.consumeConsoleMessage(
      wire({
        ts: '2026-09-06T10:00:01.600Z',
        url: fake.page.url,
        action_type: 'type',
        selector: '#password',
        text: 'hunter2',
        notes: 'password',
        field: field({ type: 'password', name: 'password', id: 'password' })
      })
    )
    clock += 300
    recorder.consumeConsoleMessage(
      wire({
        ts: '2026-09-06T10:00:01.900Z',
        url: fake.page.url,
        action_type: 'click',
        selector: '#submit',
        text: 'Sign in',
        notes: 'submit'
      })
    )
    // A navigation: intent, then arrival, then the page's own title update.
    clock += 300
    recorder.noteNavigation('will-navigate', 'https://example.com/home')
    fake.page.url = 'https://example.com/home'
    fake.page.title = 'Home'
    clock += 300
    recorder.noteNavigation('did-navigate', 'https://example.com/home')
    clock += 300
    recorder.consumeConsoleMessage(
      wire({
        ts: '2026-09-06T10:00:02.800Z',
        url: fake.page.url,
        action_type: 'scroll',
        notes: 'y=120'
      })
    )
    clock += 100
    recorder.consumeConsoleMessage(
      wire({
        ts: '2026-09-06T10:00:02.900Z',
        url: fake.page.url,
        action_type: 'scroll',
        notes: 'y=160'
      })
    )
    // A new document finished loading: force re-attach (uninstall + install).
    await recorder.noteDomReady()
    expect(fake.evaluated).toHaveLength(3)

    clock += 1000
    const result = await recorder.stop()
    expect(result.ok).toBe(true)
    // navigate, screenshot, type, type(masked), click, navigate, scroll, screenshot
    expect(result.actionCount).toBe(8)
    expect(result.durationMs).toBeGreaterThan(0)
    expect(result.path).toBe(join(directory, `${started.sessionId}.json`))

    const raw = await readFile(result.path, 'utf8')
    const document = JSON.parse(raw) as AbacoBrowserRecordingDocument

    expect(document.schema).toBe(ABACO_BROWSER_RECORDING_SCHEMA)
    expect(document.session_id).toBe(started.sessionId)
    expect(document.started_at).toBe('2026-09-06T10:00:00.000Z')
    // 6 × 300 ms of interaction, then a 100 ms flick and a 1 s pause.
    expect(document.ended_at).toBe('2026-09-06T10:00:02.900Z')
    expect(document.mode).toBe('manual')
    expect(document.initial_url).toBe('https://example.com/login')
    expect(document.final_url).toBe('https://example.com/home')
    expect(document.title).toBe('Home')
    expect(document.source_path).toBe(result.path)

    // The procedure, in order: where the user was, a picture of it, the two
    // typed fields (the second one masked), the click, the navigation, the
    // scroll — and a picture of where they ended up.
    expect(document.actions.map((entry) => entry.action_type)).toEqual([
      'navigate',
      'screenshot',
      'type',
      'type',
      'click',
      'navigate',
      'scroll',
      'screenshot'
    ])
    expect(document.actions[2]?.text).toBe('ada@example.com')
    expect(document.actions[3]?.text).toBe(ABACO_BROWSER_REDACTED_VALUE)
    expect(document.actions[3]?.redacted).toBe(true)
    expect(document.actions[5]?.notes).toBe('title="Home" | will-navigate')
    expect(document.actions[6]?.notes).toBe('y=120')
    expect(document.skipped).toEqual({
      malformedMessages: 1,
      redactedValues: 1,
      duplicateActions: 1
    })

    // The first law of this file: the password is nowhere in it.
    expect(raw).not.toContain('hunter2')
    expect(raw).toContain(ABACO_BROWSER_REDACTED_VALUE)

    // Both bookend screenshots are on disk, next to the JSON.
    const files = (await readdir(directory)).sort()
    expect(files).toEqual(
      [
        `${started.sessionId}.json`,
        `${started.sessionId}-final.png`,
        `${started.sessionId}-initial.png`
      ].sort()
    )
    expect(document.screenshots.initial).toBe(join(directory, `${started.sessionId}-initial.png`))
    expect(document.screenshots.final).toBe(join(directory, `${started.sessionId}-final.png`))
    await expect(readFile(document.screenshots.initial ?? '', 'utf8')).resolves.toBe('fake-png-bytes')

    // The page half is torn down, and the status reads back the finished session.
    // start install + noteDomReady(uninstall,install) + stop uninstall
    expect(fake.evaluated.length).toBeGreaterThanOrEqual(4)
    expect(fake.evaluated[fake.evaluated.length - 1]).toContain('__abacoRecorder')
    const status = recorder.status()
    expect(status.recording).toBe(false)
    expect(status.actionCount).toBe(8)
    expect(status.lastRecordingPath).toBe(result.path)
    expect(status.lastActionAt).toBe('2026-09-06T10:00:02.900Z')
    expect(status.lastError).toBe('')
  })

  it('records nothing when it is not recording, and refuses a stray stop', async () => {
    const directory = await tempDir()
    const fake = fakePort()
    const recorder = new AbacoBrowserRecorder({ port: fake.port, outputDir: directory, log: () => {} })

    recorder.consumeConsoleMessage(
      wire({ action_type: 'click', selector: '#a', url: 'https://example.com/' })
    )
    recorder.noteNavigation('did-navigate', 'https://example.com/2')
    await recorder.noteDomReady()
    expect(fake.evaluated).toEqual([])
    await expect(recorder.stop()).rejects.toThrow(/not recording/u)
  })

  it('still writes a recording when the page cannot be screenshotted', async () => {
    const directory = await tempDir()
    const fake = fakePort()
    fake.setPng(undefined)
    const recorder = new AbacoBrowserRecorder({ port: fake.port, outputDir: directory, log: () => {} })

    await recorder.start('manual')
    recorder.consumeConsoleMessage(
      wire({ action_type: 'click', selector: '#a', url: 'https://example.com/login' })
    )
    const result = await recorder.stop()

    expect(result.ok).toBe(true)
    const document = JSON.parse(await readFile(result.path, 'utf8')) as AbacoBrowserRecordingDocument
    expect(document.screenshots).toEqual({})
    expect(document.actions.map((entry) => entry.action_type)).toEqual(['navigate', 'click'])
    // A missing screenshot is a note the reader can act on, not a silent gap.
    expect(recorder.status().lastError).toContain('empty')
  })

  it('reports a failed write instead of pretending the recording was saved', async () => {
    const directory = await tempDir()
    const fake = fakePort()
    const recorder = new AbacoBrowserRecorder({
      port: fake.port,
      outputDir: directory,
      log: () => {},
      writeTextFile: async () => {
        throw new Error('disk full')
      }
    })

    await recorder.start('manual')
    const result = await recorder.stop()
    expect(result.ok).toBe(false)
    expect(result.path).toBe('')
    expect(recorder.status().lastError).toContain('disk full')
    // The bookend PNGs go with it: a recording the caller was told is not on
    // disk must not leave half of itself in the directory.
    expect(await readdir(directory)).toEqual([])
  })

  it('aborts without writing anything when the overlay is destroyed', async () => {
    const directory = await tempDir()
    const fake = fakePort()
    const recorder = new AbacoBrowserRecorder({ port: fake.port, outputDir: directory, log: () => {} })

    await recorder.start('manual')
    await recorder.abort()
    expect(recorder.isRecording()).toBe(false)
    expect(await readdir(directory)).toEqual([])
  })

  it('caps a runaway recording instead of growing without bound', async () => {
    const directory = await tempDir()
    const fake = fakePort()
    let clock = Date.parse('2026-09-06T10:00:00.000Z')
    const recorder = new AbacoBrowserRecorder({
      port: fake.port,
      outputDir: directory,
      now: () => new Date(clock),
      log: () => {}
    })
    await recorder.start('manual')
    for (let index = 0; index < ABACO_BROWSER_RECORD_MAX_ACTIONS + 10; index += 1) {
      clock += 5000
      recorder.consumeConsoleMessage(
        wire({
          action_type: 'click',
          selector: `#row-${index}`,
          url: 'https://example.com/login',
          ts: new Date(clock).toISOString()
        })
      )
    }
    const result = await recorder.stop()
    const document = JSON.parse(await readFile(result.path, 'utf8')) as AbacoBrowserRecordingDocument
    expect(document.actions).toHaveLength(ABACO_BROWSER_RECORD_MAX_ACTIONS)
    expect(recorder.status().lastError).toContain('ceiling')
  })
})

/* ──────────────────────────────────────────────────────────────────────────────
 * F2 — the page script, the contract and the strip
 * ────────────────────────────────────────────────────────────────────────────── */

describe('ABACO browser chrome and contract (F2)', () => {
  it('publishes the F2 channels under the documented names', () => {
    expect(abacoBrowserChannels.recordStart).toBe('abaco:browser:record-start')
    expect(abacoBrowserChannels.recordStop).toBe('abaco:browser:record-stop')
    expect(abacoBrowserChannels.recordStatus).toBe('abaco:browser:record-status')
    expect(abacoBrowserChannels.setMode).toBe('abaco:browser:set-mode')
    expect(abacoBrowserChannels.themeReport).toBe('abaco:browser:theme-report')
    expect(abacoBrowserChannels.shortcut).toBe('abaco:browser:shortcut')
    expect(ABACO_BROWSER_THEME_CHANGED_CHANNEL).toBe('abaco:browser:theme-changed')
  })

  it('registers every F2 handler in main behind the trusted-sender guard', async () => {
    const main = await readFile('src/main/index.ts', 'utf8')
    for (const name of [
      'recordStart',
      'recordStop',
      'recordStatus',
      'setMode',
      'themeReport',
      'shortcut'
    ] as const) {
      expect(main).toContain(`ipcMain.handle(abacoBrowserChannels.${name},`)
    }
    expect(main).toContain('isAbacoBrowserTheme(theme)')
    expect(main).toContain('isAbacoBrowserShortcut(shortcut)')
    // The recordings directory is derived from `userData`, never from the bundle.
    expect(main).toContain('join(app.getPath(\'userData\'), ABACO_BROWSER_RECORDINGS_DIRNAME)')
    // The Harness theme reaches the strip from the one place that resolves it.
    expect(main).toContain('abacoBrowserController?.setTheme(isDark ? \'dark\' : \'light\')')
  })

  it('exposes the recording bridge to the Harness page without the mode switch', async () => {
    const preload = await readFile('src/preload/index.ts', 'utf8')
    expect(preload).toContain('startRecording:')
    expect(preload).toContain('stopRecording:')
    expect(preload).toContain('recordingStatus:')
    expect(preload).toContain('reportTheme:')
    expect(preload).toContain('abacoBrowserChannels.recordStart')
    expect(preload).toContain('abacoBrowserChannels.themeReport')
    // F1 invariant, restated for F2: page script can read ownership, never set it.
    expect(preload).not.toContain('abacoBrowserChannels.setMode')
  })

  it('wires the decoder to console-message, and navigation with it', async () => {
    const controller = await readFile('src/main/abaco-browser-controller.ts', 'utf8')
    // The F2 hole: nothing consumed the page's console channel before this.
    expect(controller).toContain("pageContents.on('console-message'")
    expect(controller).toContain('this.recorder.consumeConsoleMessage(details.message)')
    expect(controller).toContain("this.recorder.noteNavigation('will-navigate', url)")
    expect(controller).toContain("this.recorder.noteNavigation('did-navigate', url)")
    expect(controller).toContain("this.recorder.noteNavigation('did-navigate-in-page', url)")
    expect(controller).toContain('void this.recorder.noteDomReady()')
    // Recording hands the page to the user before the first action can land.
    expect(controller).toContain("if (this.mode !== 'manual') this.setBrowserMode('manual')")
    expect(controller).toContain('async startRecording()')
    expect(controller).toContain('async stopRecording()')
    // Closing the browser saves a running recording rather than dropping it.
    expect(controller).toMatch(/if \(this\.recorder\.isRecording\(\)\) \{\s*\n\s*void this\.recorder\.stop\(\)/u)
    // Accelerators: the page's own keystrokes plus one shared table.
    expect(controller).toContain("pageContents.on('before-input-event'")
    expect(controller).toContain('abacoBrowserShortcutFor({')
    expect(controller).toContain('event.preventDefault()')
  })

  it('ships a chrome strip with the loading, title, record and drag affordances', async () => {
    const html = await readFile('build/abaco-browser-chrome.html', 'utf8')
    const preload = await readFile('src/preload/abaco-browser-chrome.ts', 'utf8')

    expect(html).toContain('id="abaco-browser-spinner"')
    expect(html).toContain('id="abaco-browser-title"')
    expect(html).toContain('id="abaco-browser-record"')
    expect(html).toContain('id="abaco-browser-record-count"')
    // The draggable strip, with every control opting back out of it.
    expect(html).toContain("body[data-platform='darwin'] .bar {\n        -webkit-app-region: drag;")
    expect(html).toContain('-webkit-app-region: no-drag')
    expect(html).toContain("body[data-theme='dark']")
    expect(html).toContain('prefers-reduced-motion')
    // Styles only: the document still runs no script of its own.
    expect(html).toContain("default-src 'none'")
    expect(html).not.toContain('<script')

    expect(preload).toContain('abacoBrowserShortcutFor({')
    expect(preload).toContain('abacoBrowserChannels.shortcut')
    expect(preload).toContain('ABACO_BROWSER_CHROME_FOCUS_ADDRESS_CHANNEL')
    expect(preload).toContain('ABACO_BROWSER_THEME_CHANGED_CHANNEL')
    expect(preload).toContain('document.body.dataset.theme = theme')
    expect(preload).toContain('spinner.hidden = !next.loading')
    expect(preload).toContain('title.textContent = next.title')
    expect(preload).toContain('abacoBrowserChannels.recordStart')
    expect(preload).toContain('abacoBrowserChannels.recordStop')
    expect(preload).toContain("recordButton.classList.toggle('is-recording', active)")
    expect(preload).toContain('document.body.dataset.platform = process.platform')
  })

  it('maps the accelerators the browser documents, and only with a modifier', () => {
    expect(abacoBrowserShortcutFor({ key: 'l', meta: true })).toBe('focus-address')
    expect(abacoBrowserShortcutFor({ key: 'L', ctrl: true })).toBe('focus-address')
    expect(abacoBrowserShortcutFor({ key: 'r', meta: true })).toBe('reload')
    expect(abacoBrowserShortcutFor({ key: 'w', meta: true })).toBe('close')
    expect(abacoBrowserShortcutFor({ key: 'ArrowLeft', meta: true })).toBe('back')
    expect(abacoBrowserShortcutFor({ key: 'ArrowRight', meta: true })).toBe('forward')
    // Shift is tolerated (⌘⇧← still means back to the user who tries it)…
    expect(abacoBrowserShortcutFor({ key: 'r', meta: true, shift: true })).toBe('reload')
    // …but Alt is not, and a bare key never is: typing "r" in a form must not
    // reload the page, and Alt+← belongs to the OS.
    expect(abacoBrowserShortcutFor({ key: 'r', meta: true, alt: true })).toBeUndefined()
    expect(abacoBrowserShortcutFor({ key: 'r' })).toBeUndefined()
    expect(abacoBrowserShortcutFor({ key: 'r', ctrl: false })).toBeUndefined()
    expect(abacoBrowserShortcutFor({ key: 'q', meta: true })).toBeUndefined()
    for (const shortcut of abacoBrowserShortcuts) {
      expect(isAbacoBrowserShortcut(shortcut)).toBe(true)
    }
    expect(isAbacoBrowserShortcut('reboot')).toBe(false)
  })

  it('serializes a page recorder body that references no enclosing binding', () => {
    // `executeJavaScript` receives `String(fn)`, so a body that referenced a
    // module-level constant would be a ReferenceError inside the page — which is
    // why the prefix and the token lists travel as arguments.
    const install = `(${installRecorderInPage.toString()})`
    const revived = new Function(`return ${install}`)()
    expect(typeof revived).toBe('function')
    const source = installRecorderInPage.toString()
    // The prefix is never a literal in the body: it arrives as `options.prefix`.
    expect(source).not.toContain(ABACO_BROWSER_RECORD_PREFIX)
    expect(source).toContain('options.prefix')
    expect(source).toContain('console.log')
    // Only trusted events are recorded — that is what keeps the agent's own
    // synthetic clicks out of a user recording.
    expect(source).toContain('isTrusted')
    expect((source.match(/isTrusted !== true/gu) ?? []).length).toBe(3)
    expect(source).toContain('addEventListener')
    expect(source).not.toContain('ABACO_')
    expect(typeof new Function(`return (${uninstallRecorderInPage.toString()})`)()).toBe('function')
  })
})
