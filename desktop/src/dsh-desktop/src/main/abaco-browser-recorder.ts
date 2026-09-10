/**
 * The ABACO browser's recorder (F2): it turns a user's session in the overlay
 * into an `AbacoBrowserRecordingDocument` on disk — the raw material of an F3
 * skill.
 *
 * ## The hole this module fills
 *
 * F0/F1 shipped a browser whose page half of the recorder existed and whose
 * consumer did not: the upstream sketch (`desktop/features/browser/
 * recorder.ts:263-348`) injects DOM listeners that emit
 * `console.log('__ABACO_REC__', json)`, but nothing in the app ever listened to
 * `console-message`, so no user action was ever recorded. This module is that
 * consumer, and it is why the feature now works:
 *
 * ```
 *  browsed page            renderer                     main
 *  ────────────            ────────                     ────
 *  listeners (F2 script) ─► console.log ──► webContents 'console-message'
 *                                                     │
 *                         decodeAbacoRecordedMessage ─┤ parse + re-redact
 *                                                     │
 *                           AbacoBrowserRecorder.append ─► merge policy
 *                                                     │
 *                      <userData>/abaco-browser/recordings/<stamp>.json
 * ```
 *
 * ## Why this file imports no `electron`
 *
 * `WebContents` never appears here. The recorder reaches the page through
 * {@link AbacoBrowserRecorderPort}, a three-method interface the controller
 * implements. That keeps the decoder, the merge policy and the persistence
 * testable in plain Node — `test/abaco-browser-recorder.test.ts` drives a whole
 * recording through a fake port and a temp directory, with no Electron runtime
 * in the picture — and it is the same seam `abaco-browser-rpc.ts` uses. The
 * page script it injects is likewise a pure module
 * (`abaco-browser-page-scripts.ts`), serialized here with
 * `Function.prototype.toString()`.
 *
 * ## Redaction
 *
 * Two independent layers, because the input is a hostile document:
 *
 *  1. the page script replaces a sensitive value *before* serializing it, so a
 *     password never reaches the console channel at all;
 *  2. {@link decodeAbacoRecordedMessage} re-derives the verdict from the element
 *     metadata the page attached (`field.type`, `field.autocomplete`,
 *     `field.name`, `field.id`) and masks again — a page that lies with
 *     `sensitive: false` still gets its `type="password"` value masked.
 *
 * @module abaco-browser-recorder
 */

import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  ABACO_BROWSER_RECORD_MAX_ACTIONS,
  ABACO_BROWSER_RECORD_MAX_NOTES,
  ABACO_BROWSER_RECORD_MAX_SELECTOR,
  ABACO_BROWSER_RECORD_MAX_TEXT,
  ABACO_BROWSER_RECORD_NAVIGATE_MERGE_MS,
  ABACO_BROWSER_RECORD_PREFIX,
  ABACO_BROWSER_RECORD_SCROLL_MERGE_MS,
  ABACO_BROWSER_RECORD_TYPE_MERGE_MS,
  ABACO_BROWSER_REDACTED_VALUE,
  ABACO_BROWSER_RECORDING_SCHEMA,
  ABACO_BROWSER_SENSITIVE_AUTOCOMPLETE,
  ABACO_BROWSER_SENSITIVE_FIELD_TOKENS,
  isAbacoBrowserRecordedActionType,
  shouldRedactBrowserValue,
  type AbacoBrowserMode,
  type AbacoBrowserRecordedAction,
  type AbacoBrowserRecordedField,
  type AbacoBrowserRecordingDocument,
  type AbacoBrowserRecordingResult,
  type AbacoBrowserRecordingStatus
} from '../shared/abaco-browser'
import {
  installRecorderInPage,
  uninstallRecorderInPage,
  type PageRecorderOptions
} from './abaco-browser-page-scripts'

/**
 * The controller surface the recorder needs, expressed structurally.
 *
 * Declaring it here rather than importing `AbacoBrowserController` keeps this
 * module — and therefore its tests — free of `electron`.
 */
export interface AbacoBrowserRecorderPort {
  /** URL and title of the page the recorded actions happen in. */
  pageInfo(): { url: string; title: string }
  /** Run already-serialized `source` inside the browsed page. */
  evaluate(source: string): Promise<unknown>
  /**
   * PNG bytes of the current view, or `undefined` when the view is not painting
   * (an occluded window, a page that never loaded). A recording is still useful
   * without its screenshots, so this is reported through `lastError` rather than
   * thrown.
   */
  capturePng(): Promise<Buffer | undefined>
}

/** Why a console message was refused, or the action it carried. */
export type AbacoBrowserRecordDecode =
  | { ok: true; action: AbacoBrowserRecordedAction; redacted: boolean }
  | { ok: false; reason: 'no-prefix' | 'malformed-json' | 'not-an-object' | 'unknown-action' }

/** How a decoded action relates to the previous one in the log. */
export type AbacoBrowserActionMerge =
  | { kind: 'append' }
  | { kind: 'replace'; action: AbacoBrowserRecordedAction }
  | { kind: 'drop' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read a string field, tolerating anything a hostile page might send. */
function stringField(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function clampText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  return value.length > max ? `${value.slice(0, max)}…` : value
}

/** Coerce the element metadata a page attached; a malformed one is dropped. */
function readField(value: unknown): AbacoBrowserRecordedField | undefined {
  if (!isRecord(value)) return undefined
  return {
    tag: stringField(value.tag),
    type: stringField(value.type),
    name: stringField(value.name),
    id: stringField(value.id),
    autocomplete: stringField(value.autocomplete)
  }
}

/**
 * The decoder: one `console-message` line in, one recorded action out.
 *
 * The message is matched against the prefix with `indexOf`, not `startsWith`,
 * because Chromium has historically prepended the source location to a console
 * message on some platforms; whatever precedes the prefix is ignored and
 * whatever follows it must be the JSON object the page built.
 *
 * Total, never throwing: this runs in a handler that fires for *every* console
 * message of *every* page the user browses, so a throw here would be a crash on
 * an unrelated `console.log`. A refusal is a value
 * ({@link AbacoBrowserRecordDecode}) the caller counts.
 */
export function decodeAbacoRecordedMessage(
  message: string,
  options: { fallbackUrl?: string; prefix?: string } = {}
): AbacoBrowserRecordDecode {
  const prefix = options.prefix ?? ABACO_BROWSER_RECORD_PREFIX
  const at = message.indexOf(prefix)
  if (at < 0) return { ok: false, reason: 'no-prefix' }

  const body = message.slice(at + prefix.length).trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return { ok: false, reason: 'malformed-json' }
  }
  if (!isRecord(parsed)) return { ok: false, reason: 'not-an-object' }
  if (!isAbacoBrowserRecordedActionType(parsed.action_type)) {
    return { ok: false, reason: 'unknown-action' }
  }

  const field = readField(parsed.field)
  const notes = clampText(parsed.notes, ABACO_BROWSER_RECORD_MAX_NOTES)
  const rawText = clampText(parsed.text, ABACO_BROWSER_RECORD_MAX_TEXT)
  const redacted = shouldRedactBrowserValue({
    field,
    sensitive: parsed.sensitive === true,
    notes
  })

  const timestamp =
    typeof parsed.ts === 'string' && !Number.isNaN(Date.parse(parsed.ts))
      ? parsed.ts
      : new Date().toISOString()
  const url =
    typeof parsed.url === 'string' && parsed.url.length > 0
      ? parsed.url
      : options.fallbackUrl ?? ''

  const selector = clampText(parsed.selector, ABACO_BROWSER_RECORD_MAX_SELECTOR)
  const action: AbacoBrowserRecordedAction = { timestamp, url, action_type: parsed.action_type }
  if (selector !== undefined && selector.length > 0) action.selector = selector
  if (rawText !== undefined) action.text = rawText
  if (notes !== undefined && notes.length > 0) action.notes = notes
  if (field) action.field = field
  if (redacted) {
    action.redacted = true
    // Only a *value* is replaced: masking a click's label or its notes would
    // erase the fact that the user pressed that control at all.
    if (action.text !== undefined) action.text = ABACO_BROWSER_REDACTED_VALUE
  }
  return { ok: true, action, redacted }
}

/** Milliseconds between two ISO timestamps, or `NaN` when either is unusable. */
function elapsedMs(from: string, to: string): number {
  return Date.parse(to) - Date.parse(from)
}

/**
 * Decide what to do with a freshly decoded action given the one before it.
 *
 * The merge policy exists because the raw event stream is not a procedure. A
 * word typed by hand arrives as one `input` event per letter, a link click
 * arrives as a `will-navigate` *and* a `did-navigate`, and one flick fires
 * hundreds of scroll events. Recorded verbatim, none of that is a step F3 could
 * turn into a skill, so:
 *
 *  - **`type`** rows on the same field and page inside
 *    {@link ABACO_BROWSER_RECORD_TYPE_MERGE_MS} collapse into one, keeping the
 *    first timestamp (when the user started on that field) and the *latest*
 *    value (each event carries the field's whole current value, so the last one
 *    is the finished one);
 *  - **`navigate`** rows for the same URL inside
 *    {@link ABACO_BROWSER_RECORD_NAVIGATE_MERGE_MS} collapse into one, merging
 *    notes — the intent (`will-navigate`) and the arrival (`did-navigate`, which
 *    carries the title) are one trip;
 *  - **`scroll`** rows are dropped when a second one lands on the same page
 *    inside {@link ABACO_BROWSER_RECORD_SCROLL_MERGE_MS}: the first position is
 *    the step, the rest is momentum.
 *
 * Anything else appends. Pure and synchronous, so the policy is unit-testable
 * without a page, a window or a clock.
 */
export function mergeRecordedAction(
  previous: AbacoBrowserRecordedAction | undefined,
  incoming: AbacoBrowserRecordedAction
): AbacoBrowserActionMerge {
  if (!previous) return { kind: 'append' }
  if (previous.action_type !== incoming.action_type) return { kind: 'append' }
  if (previous.url !== incoming.url) return { kind: 'append' }
  const elapsed = elapsedMs(previous.timestamp, incoming.timestamp)
  if (Number.isNaN(elapsed) || elapsed < 0) return { kind: 'append' }

  if (incoming.action_type === 'type') {
    if (previous.selector !== incoming.selector) return { kind: 'append' }
    if (elapsed > ABACO_BROWSER_RECORD_TYPE_MERGE_MS) return { kind: 'append' }
    const merged: AbacoBrowserRecordedAction = { ...incoming, timestamp: previous.timestamp }
    // A field that was once sensitive stays sensitive, even if the last
    // keystroke arrived after the page rewrote the control's metadata.
    if (previous.redacted === true) merged.redacted = true
    return { kind: 'replace', action: merged }
  }

  if (incoming.action_type === 'navigate') {
    if (elapsed > ABACO_BROWSER_RECORD_NAVIGATE_MERGE_MS) return { kind: 'append' }
    const merged: AbacoBrowserRecordedAction = { ...incoming, timestamp: previous.timestamp }
    const notes = mergeNotes(previous.notes, incoming.notes)
    if (notes.length > 0) merged.notes = notes
    else delete merged.notes
    return { kind: 'replace', action: merged }
  }

  if (incoming.action_type === 'scroll') {
    if (elapsed > ABACO_BROWSER_RECORD_SCROLL_MERGE_MS) return { kind: 'append' }
    return { kind: 'drop' }
  }

  return { kind: 'append' }
}

/** Keep both notes of a collapsed pair, newest first, without repeating one. */
function mergeNotes(previous: string | undefined, incoming: string | undefined): string {
  const older = (previous ?? '').trim()
  const newer = (incoming ?? '').trim()
  if (older.length === 0) return newer
  if (newer.length === 0) return older
  if (older === newer) return newer
  return `${newer} | ${older}`.slice(0, ABACO_BROWSER_RECORD_MAX_NOTES)
}

/** Everything injectable, so a test can drive a whole recording. */
export interface AbacoBrowserRecorderOptions {
  port: AbacoBrowserRecorderPort
  /** `<userData>/abaco-browser/recordings`. */
  outputDir: string
  /** Clock, for deterministic timestamps in tests. */
  now?: () => Date
  /** Disk seams, so the persistence path is testable without touching a disk. */
  writeTextFile?: (path: string, data: string) => Promise<void>
  writeBinaryFile?: (path: string, data: Buffer) => Promise<void>
  ensureDir?: (path: string) => Promise<void>
  removeFile?: (path: string) => Promise<void>
  log?: (message: string) => void
  /** Wire prefix; defaults to {@link ABACO_BROWSER_RECORD_PREFIX}. */
  prefix?: string
  /**
   * The page half. Injectable so the recorder can be exercised without
   * serializing anything; defaults to the real `abaco-browser-page-scripts`
   * bodies.
   */
  pageScript?: {
    install: (options: PageRecorderOptions) => unknown
    uninstall: () => unknown
    options?: PageRecorderOptions
  }
}

/** The redaction state of one session, kept out of the document until `stop()`. */
interface AbacoRecorderTally {
  malformedMessages: number
  redactedValues: number
  duplicateActions: number
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * One recording session at a time, owned by one `AbacoBrowserController`.
 *
 * The controller forwards events to it (`consumeConsoleMessage`,
 * `noteNavigation`, `noteDomReady`) instead of the recorder subscribing to
 * `WebContents` itself: the controller already owns those subscriptions, and
 * keeping them there is what lets this class run in a test process.
 */
export class AbacoBrowserRecorder {
  private readonly port: AbacoBrowserRecorderPort
  private readonly outputDir: string
  private readonly now: () => Date
  private readonly writeTextFile: (path: string, data: string) => Promise<void>
  private readonly writeBinaryFile: (path: string, data: Buffer) => Promise<void>
  private readonly ensureDir: (path: string) => Promise<void>
  private readonly removeFile: (path: string) => Promise<void>
  private readonly log: (message: string) => void
  private readonly prefix: string
  private readonly pageScript: {
    install: (options: PageRecorderOptions) => unknown
    uninstall: () => unknown
    options: PageRecorderOptions
  }

  private document: AbacoBrowserRecordingDocument | undefined
  private tally: AbacoRecorderTally = {
    malformedMessages: 0,
    redactedValues: 0,
    duplicateActions: 0
  }
  private summary = {
    sessionId: '',
    startedAt: '',
    actionCount: 0,
    lastActionAt: '',
    lastRecordingPath: '',
    lastError: ''
  }

  constructor(options: AbacoBrowserRecorderOptions) {
    this.port = options.port
    this.outputDir = options.outputDir
    this.now = options.now ?? (() => new Date())
    this.writeTextFile =
      options.writeTextFile ?? (async (path, data) => { await writeFile(path, data, 'utf8') })
    this.writeBinaryFile =
      options.writeBinaryFile ?? (async (path, data) => { await writeFile(path, data) })
    this.ensureDir = options.ensureDir ?? (async (path) => { await mkdir(path, { recursive: true }) })
    this.removeFile = options.removeFile ?? (async (path) => { await rm(path, { force: true }) })
    this.log = options.log ?? ((message) => console.warn(`[abaco-browser-recorder] ${message}`))
    this.prefix = options.prefix ?? ABACO_BROWSER_RECORD_PREFIX
    this.pageScript = {
      install: options.pageScript?.install ?? installRecorderInPage,
      uninstall: options.pageScript?.uninstall ?? uninstallRecorderInPage,
      options:
        options.pageScript?.options ??
        ({
          prefix: this.prefix,
          redactedValue: ABACO_BROWSER_REDACTED_VALUE,
          maxSelector: ABACO_BROWSER_RECORD_MAX_SELECTOR,
          scrollMergeMs: ABACO_BROWSER_RECORD_SCROLL_MERGE_MS,
          sensitiveTokens: [...ABACO_BROWSER_SENSITIVE_FIELD_TOKENS],
          sensitiveAutocomplete: [...ABACO_BROWSER_SENSITIVE_AUTOCOMPLETE]
        } satisfies PageRecorderOptions)
    }
  }

  /** True between `start()` and `stop()`. */
  isRecording(): boolean {
    return this.document !== undefined
  }

  /** Actions captured so far; the chrome bar shows the count while recording. */
  actionCount(): number {
    return this.document?.actions.length ?? this.summary.actionCount
  }

  /** Live state for `abaco:browser:record-status` and the chrome bar. */
  status(): AbacoBrowserRecordingStatus {
    const document = this.document
    if (!document) {
      return {
        recording: false,
        sessionId: this.summary.sessionId,
        startedAt: this.summary.startedAt,
        actionCount: this.summary.actionCount,
        lastActionAt: this.summary.lastActionAt,
        lastRecordingPath: this.summary.lastRecordingPath,
        lastError: this.summary.lastError
      }
    }
    return {
      recording: true,
      sessionId: document.session_id,
      startedAt: document.started_at,
      actionCount: document.actions.length,
      lastActionAt: document.actions[document.actions.length - 1]?.timestamp ?? '',
      lastRecordingPath: '',
      lastError: this.summary.lastError
    }
  }

  /**
   * Begin a recording. Resolves once the page script is installed and the
   * opening screenshot has been attempted, so the caller flips the chrome bar
   * into ⏺ only after the recorder can actually see the user.
   *
   * `mode` is the ownership at start. The controller hands over to `manual`
   * first (recording is a human demonstration), so the recorded actions are the
   * user's and not a mix of both drivers.
   */
  async start(mode: AbacoBrowserMode): Promise<AbacoBrowserRecordingStatus> {
    if (this.document) return this.status()
    const startedAt = this.now().toISOString()
    const info = this.port.pageInfo()
    this.tally = { malformedMessages: 0, redactedValues: 0, duplicateActions: 0 }
    this.summary = {
      sessionId: startedAt.replace(/[:.]/gu, '-'),
      startedAt,
      actionCount: 0,
      lastActionAt: '',
      lastRecordingPath: '',
      lastError: ''
    }
    this.document = {
      schema: ABACO_BROWSER_RECORDING_SCHEMA,
      session_id: this.summary.sessionId,
      started_at: startedAt,
      ended_at: '',
      initial_url: info.url,
      final_url: info.url,
      title: info.title,
      mode,
      actions: [],
      screenshots: {},
      skipped: { malformedMessages: 0, redactedValues: 0, duplicateActions: 0 }
    }

    try {
      await this.ensureDir(this.outputDir)
    } catch (error) {
      this.noteError(`could not create ${this.outputDir}: ${describe(error)}`)
    }
    // Order matters for the reader: the first action is *where the user was*,
    // the second is what that looked like. F3 opens the file and reads the page
    // before it reads any step.
    this.append({
      timestamp: startedAt,
      url: info.url,
      action_type: 'navigate',
      notes: `initial page; title="${info.title}"`
    })
    await this.installPageScript()
    await this.capture('initial')
    return this.status()
  }

  /**
   * Stop, persist and return. A recording that captured nothing is still
   * written: "you never interacted with the page" is a fact the caller wants to
   * read, not a missing file.
   */
  async stop(): Promise<AbacoBrowserRecordingResult> {
    const document = this.document
    if (!document) throw new Error('The ABACO browser recorder is not recording.')
    const endedAt = this.now().toISOString()
    document.ended_at = endedAt
    const info = this.port.pageInfo()
    document.final_url = info.url
    document.title = info.title

    // The final screenshot is part of the session, so it is taken before the
    // session is dropped; the page listeners come off straight after it.
    await this.capture('final')
    this.document = undefined
    await this.uninstallPageScript()

    const path = join(this.outputDir, `${document.session_id}.json`)
    document.source_path = path
    document.skipped = { ...this.tally }
    const actionCount = document.actions.length
    this.summary = {
      sessionId: document.session_id,
      startedAt: document.started_at,
      actionCount,
      lastActionAt: document.actions[actionCount - 1]?.timestamp ?? '',
      lastRecordingPath: '',
      lastError: this.summary.lastError
    }
    try {
      await this.ensureDir(this.outputDir)
      await this.writeTextFile(path, JSON.stringify(document, null, 2))
    } catch (error) {
      this.noteError(`could not write ${path}: ${describe(error)}`)
      return {
        ok: false,
        path: '',
        sessionId: document.session_id,
        actionCount,
        durationMs: Math.max(0, elapsedMs(document.started_at, endedAt))
      }
    }
    this.summary = { ...this.summary, lastRecordingPath: path }
    return {
      ok: true,
      path,
      sessionId: document.session_id,
      actionCount,
      durationMs: Math.max(0, elapsedMs(document.started_at, endedAt))
    }
  }

  /**
   * Stop without persisting what is left. Used when the overlay is destroyed
   * mid-recording: there is no page left to screenshot, and half a recording
   * written on teardown would be worse than none. The bookend PNGs already on
   * disk are removed with it, so an aborted session leaves no orphan files
   * behind — the recordings directory only ever holds complete recordings.
   */
  async abort(): Promise<void> {
    const document = this.document
    if (!document) return
    this.document = undefined
    await this.uninstallPageScript(true)
    for (const path of Object.values(document.screenshots)) {
      try {
        await this.removeFile(path)
      } catch {
        // A screenshot that was never written cannot be removed; nothing to do.
      }
    }
  }

  /** One `console-message` line from the browsed page — the F2 decoder's input. */
  consumeConsoleMessage(message: string): void {
    if (!this.document) return
    const decoded = decodeAbacoRecordedMessage(message, {
      prefix: this.prefix,
      fallbackUrl: this.port.pageInfo().url
    })
    if (!decoded.ok) {
      // `no-prefix` is every ordinary `console.log` of every browsed page;
      // counting it would drown the number that matters.
      if (decoded.reason !== 'no-prefix') this.tally.malformedMessages += 1
      return
    }
    if (decoded.redacted) this.tally.redactedValues += 1
    this.append(decoded.action)
  }

  /**
   * A navigation the controller observed. `will-navigate` is the intent and
   * `did-navigate`/`did-navigate-in-page` the arrival; {@link mergeRecordedAction}
   * collapses a matching pair into one step.
   */
  noteNavigation(
    kind: 'will-navigate' | 'did-navigate' | 'did-navigate-in-page',
    url: string
  ): void {
    if (!this.document) return
    const info = this.port.pageInfo()
    this.append({
      timestamp: this.now().toISOString(),
      url,
      action_type: 'navigate',
      notes: kind === 'will-navigate' ? 'will-navigate' : `title="${info.title}"`
    })
  }

  /**
   * The page finished loading — possibly a new document. Re-installing the
   * listeners after a navigation is the normal case, not an edge case: the user
   * clicks a link and the previous document's listeners are gone with it.
   */
  async noteDomReady(): Promise<void> {
    if (!this.document) return
    await this.installPageScript()
  }

  /** Serialize the page-side installer and run it in the browsed document. */
  private async installPageScript(): Promise<void> {
    const source = `(${this.pageScript.install.toString()})(${JSON.stringify(this.pageScript.options)})`
    try {
      await this.port.evaluate(source)
    } catch (error) {
      this.noteError(`could not install the page recorder: ${describe(error)}`)
    }
  }

  private async uninstallPageScript(silent = false): Promise<void> {
    try {
      await this.port.evaluate(`(${this.pageScript.uninstall.toString()})()`)
    } catch (error) {
      if (!silent) this.noteError(`could not remove the page recorder: ${describe(error)}`)
    }
  }

  /** Take a bookend screenshot; a view that cannot paint is a note, not a failure. */
  private async capture(which: 'initial' | 'final'): Promise<void> {
    const document = this.document
    if (!document) return
    let png: Buffer | undefined
    try {
      png = await this.port.capturePng()
    } catch (error) {
      this.noteError(`could not capture the ${which} screenshot: ${describe(error)}`)
      return
    }
    if (!png || png.byteLength === 0) {
      this.noteError(`the ${which} screenshot was empty (is the window visible?)`)
      return
    }
    const path = join(this.outputDir, `${document.session_id}-${which}.png`)
    try {
      await this.ensureDir(this.outputDir)
      await this.writeBinaryFile(path, png)
    } catch (error) {
      this.noteError(`could not write ${path}: ${describe(error)}`)
      return
    }
    document.screenshots[which] = path
    this.append({
      timestamp: this.now().toISOString(),
      url: this.port.pageInfo().url,
      action_type: 'screenshot',
      screenshot_path: path,
      notes: which
    })
  }

  /** Apply the merge policy and push the action into the session. */
  private append(action: AbacoBrowserRecordedAction): void {
    const document = this.document
    if (!document) return
    if (document.actions.length >= ABACO_BROWSER_RECORD_MAX_ACTIONS) {
      this.noteError(`the recording reached its ${ABACO_BROWSER_RECORD_MAX_ACTIONS}-action ceiling`)
      return
    }
    const merge = mergeRecordedAction(document.actions[document.actions.length - 1], action)
    if (merge.kind === 'drop') {
      this.tally.duplicateActions += 1
      return
    }
    if (merge.kind === 'replace') document.actions[document.actions.length - 1] = merge.action
    else document.actions.push(action)
  }

  private noteError(message: string): void {
    this.summary = { ...this.summary, lastError: message }
    this.log(message)
  }
}
