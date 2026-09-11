/**
 * The append-only JSONL sink for `abaco-observability`.
 *
 * ## What "append-only" has to mean here
 *
 * The deliverable is `<DSH_HOME>/logs/abaco-context.jsonl`: one JSON object per
 * line, one line per observed event, and never a rewrite. The file is read by a
 * human after a long session and, later, by CI, so a half-written line is worse
 * than a missing one — it makes every subsequent line unparseable to a
 * line-per-record reader.
 *
 * **A `write()` is a real append when it returns.** The file is opened once
 * with `O_APPEND` and each record is written with one `writeSync` of one line.
 * That choice is not an optimisation preference, it is what makes the two
 * properties the criterion needs true rather than likely:
 *
 * - **Durable now.** A record is on disk before the event that produced it
 *   returns from the listener, so a crash, a `kill -9`, or a torn-down process
 *   cannot take the evidence with it. A buffered sink that flushes "soon" loses
 *   exactly the compactions that end badly — the ones worth recording.
 * - **Whole.** One `writeSync` of a short line to an `O_APPEND` descriptor
 *   either lands entirely or reports an error; there is no window in which
 *   another writer can interleave into the middle of a record, and only whole
 *   lines are ever passed in.
 *
 * The cost is a synchronous disk write per *compaction-family* event, which in
 * a long session is a handful of writes per hour — not a per-token, per-chunk
 * or per-message path. Nothing in this file is on a hot path, and the events it
 * records are precisely the ones a lost buffer would hide.
 *
 * `asyncWrites: true` switches to a coalesced asynchronous sink for callers who
 * measure differently. It gives up the "durable when `write()` returns"
 * guarantee and says so here rather than in a commit message.
 *
 * Every filesystem failure is reported through the logger and swallowed: a
 * read-only `$DSH_HOME` must degrade telemetry, never the boot.
 *
 * @module abaco-observability/lib/log
 */

import { appendFile, mkdirSync, writeSync, openSync, closeSync } from 'node:fs'
import { mkdir as mkdirAsync, appendFile as appendFileAsync } from 'node:fs/promises'
import { dirname } from 'node:path'

/** True when `value` carries everything a JSONL record needs. */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Whether one serialized record would break the one-line-per-record contract.
 *
 * Exported and named so it is directly testable. It is defensive today:
 * `JSON.stringify` escapes every newline it produces, including one injected
 * through `toJSON`, so no input has yet been found that trips it. It stays
 * because the JSONL reader on the other side splits on `\n`, which makes "no
 * newline inside a record" the invariant the whole stream rests on — and an
 * invariant that is only true by accident of the encoder is one encoder change
 * away from being false.
 *
 * @param json - a serialized record.
 * @returns `true` when the text carries a newline and must be rejected.
 */
export function guardRejectsNewline(json) {
  return typeof json !== 'string' || json.includes('\n')
}

/**
 * Serialize one record to a single JSONL line.
 *
 * Returns `undefined` — never a partial line — when the record cannot be
 * serialized, so a malformed payload can never corrupt the stream.
 *
 * @param record - the record to serialize.
 * @returns the line with its terminator, or `undefined`.
 */
export function serializeRecord(record) {
  if (!isRecord(record)) return undefined
  let json
  try {
    json = JSON.stringify(record)
  } catch {
    return undefined
  }
  if (typeof json !== 'string') return undefined
  // `JSON.stringify` escapes every newline inside strings, but a record built
  // by hand could still carry a bare `\n` in a key. Splitting the stream is the
  // one outcome that must be impossible, so it is checked rather than assumed.
  if (guardRejectsNewline(json)) return undefined
  return `${json}\n`
}

/**
 * An append-only JSONL sink.
 *
 * Construction opens nothing: the directory and the descriptor are created on
 * the first write, so mounting the plugin cannot fail because of a filesystem
 * problem, and a row that observes nothing never creates a file.
 */
export class ObservabilityLog {
  #path
  #logger
  #async
  #fd
  #dirReady = false
  #pending = ''
  #flush = undefined
  #writes = 0
  #lost = 0
  #errors = 0
  #lastError

  /**
   * @param options - `{ path, logger, asyncWrites }`.
   */
  constructor({ path, logger, asyncWrites = false }) {
    this.#path = path
    this.#logger = logger
    this.#async = asyncWrites === true
  }

  /** The JSONL path this sink appends to. */
  get path() {
    return this.#path
  }

  /** Counters for the self-check line: written records, dropped records, I/O errors. */
  stats() {
    return {
      writes: this.#writes,
      lost: this.#lost,
      errors: this.#errors,
      ...(this.#lastError === undefined ? {} : { lastError: this.#lastError })
    }
  }

  /**
   * Append one record.
   *
   * @param record - a JSON-serializable object.
   * @returns `true` when the record reached the file (synchronous mode) or was
   *   accepted for writing (asynchronous mode).
   */
  write(record) {
    const line = serializeRecord(record)
    if (line === undefined) {
      this.#lost += 1
      this.#logger?.warn?.('abaco-observability: dropped a telemetry record that could not be serialized as one JSONL line')
      return false
    }
    return this.#async ? this.#writeAsync(line) : this.#writeSyncNow(line)
  }

  /** Ensure the parent directory exists, once. */
  #ensureDir() {
    if (this.#dirReady) return
    mkdirSyncSafe(dirname(this.#path), this.#logger)
    this.#dirReady = true
  }

  /** One durable append of one whole line. */
  #writeSyncNow(line) {
    this.#ensureDir()
    try {
      if (this.#fd === undefined) this.#fd = openSync(this.#path, 'a', 0o600)
      writeSync(this.#fd, line)
      this.#writes += 1
      return true
    } catch (error) {
      this.#fail(error)
      return false
    }
  }

  /** Queue one line for a coalesced asynchronous append. */
  #writeAsync(line) {
    this.#pending += line
    if (this.#flush === undefined) this.#flush = this.#runAsync()
    return true
  }

  /**
   * Drain the pending batch once and record the in-flight promise.
   *
   * The batch is taken synchronously so records written while the append is in
   * flight form the next batch instead of being cleared by this one. No timer
   * is involved, so a closing harness is never held open by telemetry.
   */
  #runAsync() {
    const batch = this.#pending
    this.#pending = ''
    return (async () => {
      if (batch.length > 0) {
        try {
          await mkdirAsync(dirname(this.#path), { recursive: true })
          await appendFileAsync(this.#path, batch, { encoding: 'utf8', mode: 0o600 })
          this.#writes += batch.split('\n').length - 1
        } catch (error) {
          this.#fail(error)
        }
      }
      this.#flush = undefined
      // Records that arrived while this append was in flight must not wait for
      // another event to trigger them.
      if (this.#pending.length > 0) this.#flush = this.#runAsync()
    })()
  }

  /** Report one I/O failure once per occurrence, and keep observing. */
  #fail(error) {
    this.#errors += 1
    this.#lastError = describeError(error)
    // Loud, but fatal to nothing: the row keeps observing, and the operator is
    // told the stream has a hole in it.
    this.#logger?.warn?.(`abaco-observability: could not append telemetry to ${this.#path}: ${this.#lastError}`)
  }

  /** Resolve once everything accepted so far has been attempted. */
  async flush() {
    for (let pass = 0; pass < 1000; pass += 1) {
      const current = this.#flush
      if (current === undefined && this.#pending.length === 0) return
      await current
    }
    this.#logger?.warn?.('abaco-observability: flush() did not drain within its bounded pass count')
  }

  /** Release the descriptor. Safe to call more than once. */
  close() {
    if (this.#fd === undefined) return
    try {
      closeSync(this.#fd)
    } catch {
      /* a descriptor that cannot be closed is not worth failing a shutdown for */
    }
    this.#fd = undefined
  }

  /** Whether anything is still waiting to be written. */
  get idle() {
    return this.#flush === undefined && this.#pending.length === 0
  }
}

/** `mkdirSync` behind a catch, so a bad path degrades instead of throwing. */
function mkdirSyncSafe(directory, logger) {
  try {
    mkdirSync(directory, { recursive: true })
  } catch (error) {
    logger?.warn?.(`abaco-observability: could not create ${directory}: ${String(error?.message ?? error)}`)
  }
}

/** Render an unknown thrown value for a log line. */
export function describeError(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

