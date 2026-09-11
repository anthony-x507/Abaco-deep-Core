/**
 * `abaco-vault` — Layer 3 (delegation / «no meter basura en la ventana») of the
 * ABACO DEEP HARNES 3-layer context system. Host half.
 *
 * ## The hole this plugin closes
 *
 * A delegated child hands its report back through one of two paths, and only one
 * of them is bounded today (design §1.4):
 *
 * 1. **Foreground `subagent`** → the child's verdict is an ordinary tool result,
 *    so it travels the `tools/post-execute` waterfall and the stock
 *    `dsh-spill-policy` truncates it at `maxInlineBytes` (50000 in the shipped
 *    tree) into a *temporary* directory (`dsh-spill-local` uses
 *    `mkdtemp(tmpdir())`, swept after 30 days).
 * 2. **Background / continuable child (settlement notice)** → the child is
 *    delivered to the parent as a `user/message` carrying
 *    `source.kind: 'subagent-settled'` with `terminal.output` embedded
 *    **verbatim and unbounded** (`dsh-subagent/lib/index.js:1761-1796`). It never
 *    enters `tools/post-execute`, so nothing shortens it but compaction. That is
 *    the main remaining leak, and the reason this plugin exists.
 *
 * ## The two arms
 *
 * - **Arm A — `agent/pre-step` (waterfall, `{prepend: true}`).** Before the loop
 *   appends `decision.messages` to the session (`dsh-agent-loop/lib/index.js:506-518,559`),
 *   an oversized settlement notice is saved verbatim under
 *   `<DSH_HOME>/abaco-memory/vault/<sessionId>/<epochMs>-<slug>.txt`, indexed in
 *   `vault/index.jsonl`, and replaced by its leading lines plus the stock-shaped
 *   recovery line. `message.source` keeps its identity, so attribution — and the
 *   client's settlement card — is untouched.
 * - **Arm B — `tools/post-execute` (waterfall, `{prepend: true}`, best-effort).**
 *   Large plain-text tool results get the same *durable* copy and index entry.
 *   The stock policy already bounds what the model sees; what it does not do is
 *   keep the full text anywhere the user still owns tomorrow. This arm therefore
 *   never rewrites the decision — it only adds durability. `read` (which would
 *   create a `read → vault → read` loop) and nested calls (`exec.parent !== undefined`)
 *   are skipped, exactly like the stock policy.
 *
 * ## Rules this plugin obeys
 *
 * - **Sidecar files only.** Nothing here appends to the session log: its event
 *   vocabulary is closed (`assertEventsSupported`,
 *   `dsh-session-persistence/lib/index.js:1318-1323`), so an `abaco-vault/save`
 *   event would produce a log the harness refuses to reopen.
 * - **Never breaks the tree.** `apply` cannot throw: the harness home helper is
 *   imported dynamically and any failure falls back to `$DSH_HOME`/`~/.dsh`, and
 *   every listener body is wrapped so a filesystem failure degrades to "keep the
 *   text inline" plus a `logger.warn`. A successful tool call must never become
 *   an error because the vault was unwritable.
 * - **Never guesses.** A message or result whose shape this plugin does not
 *   positively recognize is left byte-identical (`lib/plan.js`).
 * - **Declared services only.** `inject: ['tools']` — the waterfall this plugin
 *   transforms — mirroring `dsh-spill-policy`. No property is ever assigned onto
 *   `ctx`.
 *
 * @module abaco-vault
 */

import { createHash, randomUUID } from 'node:crypto'
import { appendFile, chmod, mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { artifactFileName, capSettlementOutput, composeVaultedText, flattenPlainText, planSettledRewrite, renderOmittedNotice, settledMessageText, slugify, utf8Bytes, withReplacedContent, DEFAULT_HEAD_LINES, DEFAULT_MAX_SETTLED_BYTES } from './lib/plan.js'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'abaco-vault'

/**
 * The only service this half needs: `tools`, because its `tools/post-execute`
 * waterfall is the extension point arm B transforms. Arm A listens on
 * `agent/pre-step`, which is an event, not a service.
 */
export const inject = ['tools']

/** The memory directory Layer 2 owns; the vault is a subdirectory of it. */
export const MEMORY_DIR_NAME = 'abaco-memory'

/** Subdirectory of {@link MEMORY_DIR_NAME} that holds the artifacts. */
export const VAULT_DIR_NAME = 'vault'

/** Append-only journal of every artifact this plugin writes. */
export const VAULT_INDEX_FILE = 'index.jsonl'

/** Default cap, in UTF-8 bytes, above which a plain-text tool result is vaulted. */
export const DEFAULT_VAULT_INLINE_CHARS = 12000

/** The tool whose own output must never be re-vaulted (loop guard, stock rule). */
const READ_TOOL_NAME = 'read'

/**
 * Plugin configuration.
 *
 * Every field is optional, and every field falls back to its own default on its
 * own: the per-field `.catch(...)` matters because Cordis validates the whole
 * config in one call (`@deepseek-ai/cordis/lib/index.js:956-959`) — a single
 * typo in the row must not discard its valid siblings, least of all `root`. The
 * trailing `.default({}).catch({})` covers the row that passes no config at all
 * (and a config that is not even an object), so this schema can never produce a
 * `ValidationError` that takes the plugin tree down at boot. Thresholds are
 * positive byte counts — to switch an arm off use `enabled` /
 * `vaultToolResults`, not a zero threshold.
 */
export const Config = z.object({
  /** The Layer-2 memory directory (same meaning as `abaco-memory`'s `root`); the vault is its `vault/` child. Unset ⇒ `<DSH_HOME>/abaco-memory`. */
  root: z.string().optional().catch(undefined),
  /** When false, neither arm is registered. */
  enabled: z.boolean().default(true).catch(true),
  /** Cap, in UTF-8 bytes, above which a settlement notice is vaulted. */
  maxSettledBytes: z.number().default(DEFAULT_MAX_SETTLED_BYTES).catch(DEFAULT_MAX_SETTLED_BYTES),
  /** How many leading lines of a vaulted notice stay inline. */
  headLines: z.number().default(DEFAULT_HEAD_LINES).catch(DEFAULT_HEAD_LINES),
  /** Cap, in UTF-8 bytes, above which a tool result earns a durable copy. */
  vaultInlineChars: z.number().default(DEFAULT_VAULT_INLINE_CHARS).catch(DEFAULT_VAULT_INLINE_CHARS),
  /** When false, arm B (`tools/post-execute`) is not registered. */
  vaultToolResults: z.boolean().default(true).catch(true)
}).default({}).catch({})

/* ────────────────────────────────────────────────────────────────────────────
 * Path resolution
 * ──────────────────────────────────────────────────────────────────────────── */

/** Expand a leading `~`, mirroring `dsh-home-paths`' `expandHomePath`. */
function expandTilde(path) {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

/**
 * Resolve the vault root — the only place this plugin decides *where* artifacts
 * live, kept separate from the plumbing so it can be tested without a harness.
 *
 * Precedence matches `dsh-home-paths`' `resolveDshHome`
 * (`dsh-home-paths/lib/index.js:73-84`): an explicit `$DSH_HOME`, then the
 * harness's own helper, then `~/.dsh`. The shell sets `DSH_HOME = <userData>/harness`
 * for every harness child (`src/main/index.ts`), so a packaged app stores
 * artifacts at
 * `~/Library/Application Support/abaco-deep-core/harness/abaco-memory/vault/`.
 *
 * @param env - environment mapping to read `DSH_HOME` from.
 * @param homePathFn - optional `dshHomePath`-shaped helper, called with the
 *   segments to append. A helper that throws or returns junk is ignored.
 * @returns the absolute vault root (not created here).
 */
export function resolveVaultRoot(env = process.env, homePathFn) {
  const fromEnv = env?.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    return join(resolve(expandTilde(fromEnv.trim())), MEMORY_DIR_NAME, VAULT_DIR_NAME)
  }
  if (typeof homePathFn === 'function') {
    try {
      const resolved = homePathFn(MEMORY_DIR_NAME, VAULT_DIR_NAME)
      if (typeof resolved === 'string' && resolved.trim().length > 0) return resolve(resolved)
    } catch {
      // A helper that throws is not a reason to lose the vault: fall through.
    }
  }
  return join(homedir(), '.dsh', MEMORY_DIR_NAME, VAULT_DIR_NAME)
}

/**
 * Load `dshHomePath` from `@deepseek-ai/dsh-home-paths`.
 *
 * Dynamic and guarded on purpose: a static import would make the row's module
 * resolution a boot dependency, and this plugin must never be the reason the
 * plugin tree fails to start.
 *
 * @returns the helper, or `undefined` when it is not resolvable.
 */
async function loadHomePathFn() {
  try {
    const module = await import('@deepseek-ai/dsh-home-paths')
    const helper = module?.dshHomePath ?? module?.default?.dshHomePath
    return typeof helper === 'function' ? helper : undefined
  } catch {
    return undefined
  }
}

/** A positive integer from config, or the fallback. */
function positiveInteger(value, fallback) {
  return Number.isFinite(value) && Math.trunc(value) > 0 ? Math.trunc(value) : fallback
}

/**
 * Normalize the row's `config` block.
 *
 * Hand-rolled on top of {@link Config} for the same reason `abaco-memory` does
 * it: a wrong value should degrade to its default, never to a plugin that does
 * not load. `root` is kept as the *override string* only — turning it into an
 * absolute path is {@link effectiveVaultRoot}'s job (it needs the harness home
 * helper, which is loaded asynchronously).
 *
 * @param raw - the row's `config` block.
 * @returns the resolved configuration.
 */
export function resolveVaultConfig(raw) {
  const config = raw !== null && typeof raw === 'object' ? raw : {}
  const root = typeof config.root === 'string' && config.root.trim().length > 0 ? resolve(expandTilde(config.root.trim())) : undefined
  return {
    root,
    enabled: config.enabled !== false,
    maxSettledBytes: positiveInteger(config.maxSettledBytes, DEFAULT_MAX_SETTLED_BYTES),
    headLines: positiveInteger(config.headLines, DEFAULT_HEAD_LINES),
    vaultInlineChars: positiveInteger(config.vaultInlineChars, DEFAULT_VAULT_INLINE_CHARS),
    vaultToolResults: config.vaultToolResults !== false
  }
}

/**
 * The absolute vault root for a resolved config: the explicit `root`'s `vault/`
 * child when configured, otherwise {@link resolveVaultRoot}.
 *
 * @param config - a {@link resolveVaultConfig} result.
 * @param env - environment mapping to read `DSH_HOME` from.
 * @param homePathFn - optional `dshHomePath`-shaped helper.
 * @returns the absolute vault root.
 */
export function effectiveVaultRoot(config, env = process.env, homePathFn) {
  if (typeof config?.root === 'string' && config.root.length > 0) return join(config.root, VAULT_DIR_NAME)
  return resolveVaultRoot(env, homePathFn)
}

/* ────────────────────────────────────────────────────────────────────────────
 * Vault plumbing: atomic 0600 artifacts plus an append-only index
 * ──────────────────────────────────────────────────────────────────────────── */

/** A safe single path segment for a session id. */
function sessionSegment(sessionId) {
  return slugify(sessionId, 'session')
}

/** Hex sha256 of the artifact text, so a recovery can be checked against the index. */
function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * A target path that does not exist yet.
 *
 * `<epochMs>-<slug>.txt` is not guaranteed unique: two settlements can land in
 * the same millisecond. Renaming onto an existing artifact would silently
 * destroy it, so a taken name gets a numeric suffix instead.
 *
 * @param directory - the session's artifact directory.
 * @param fileName - the base file name.
 * @returns an unused absolute path.
 */
async function unusedTarget(directory, fileName) {
  const base = fileName.replace(/\.txt$/, '')
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const candidate = join(directory, attempt === 0 ? fileName : `${base}-${attempt}.txt`)
    try {
      await stat(candidate)
    } catch {
      return candidate
    }
  }
  return join(directory, `${base}-${Date.now().toString(36)}.txt`)
}

/**
 * Write one artifact: `0700` session directory, `0600` file, atomic commit.
 *
 * The temporary file plus `rename` is the same discipline Layer 2 uses for its
 * documents: a reader either sees the previous state or the complete new text,
 * never a half-written report.
 *
 * @param options - root, session, file name and the verbatim text.
 * @returns the absolute artifact path.
 */
async function writeArtifact({ root, sessionId, fileName, text }) {
  const directory = join(root, sessionSegment(sessionId))
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const target = await unusedTarget(directory, fileName)
  const temporary = `${target}.${process.pid.toString(36)}${Math.random().toString(36).slice(2, 8)}.tmp`
  try {
    await writeFile(temporary, text, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    await rename(temporary, target)
  } catch (error) {
    await unlink(temporary).catch(() => {})
    throw error
  }
  // `mode` above is subject to umask; make the guarantee explicit.
  await chmod(target, 0o600).catch(() => {})
  return target
}

/** Append one JSON line to `vault/index.jsonl` (created `0600` on first use). */
async function appendIndex(root, record) {
  await mkdir(root, { recursive: true, mode: 0o700 })
  await appendFile(join(root, VAULT_INDEX_FILE), `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 })
}

/**
 * Save `text` verbatim and journal it.
 *
 * A failure to write the artifact is fatal for the caller's rewrite (the text
 * must stay inline). A failure to append the index line is not: the artifact on
 * disk is still a complete, greppable copy, so it is reported and the locator is
 * returned anyway — losing the index entry must not also lose the recovery.
 *
 * @param options - root, session id, artifact kind, verbatim text, slug, extra
 *   index fields, timestamp and the diagnostic sink.
 * @returns `{ locator, bytes, sha256, id }`.
 */
export async function vaultText({ root, sessionId, kind, text, slug, extra = {}, now = Date.now(), logger }) {
  const fileName = artifactFileName(sessionId, now, slug)
  const locator = await writeArtifact({ root, sessionId, fileName, text })
  const bytes = utf8Bytes(text)
  const sha256 = sha256Hex(text)
  const id = randomUUID()
  const record = { id, sessionId, kind, bytes, sha256, locator, createdAt: new Date(now).toISOString(), ...extra }
  try {
    await appendIndex(root, record)
  } catch (error) {
    logger?.warn?.(`abaco-vault: artifact saved at ${locator} but the index entry failed: ${describe(error)}`)
  }
  return { locator, bytes, sha256, id }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Diagnostics
 * ──────────────────────────────────────────────────────────────────────────── */

/** A readable message out of an unknown thrown value. */
function describe(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The logger to use, without assuming one is reachable.
 *
 * Cordis throws on reading a service that was not injected, so the probe is
 * guarded: a missing logger must degrade to silence, never to a plugin that
 * fails to load.
 *
 * @param ctx - the plugin context.
 * @returns a `{ info, warn, error }` sink.
 */
function safeLogger(ctx) {
  const fallback = { info: () => {}, warn: () => {}, error: () => {} }
  try {
    const logger = ctx?.logger
    if (logger !== null && typeof logger === 'object' && typeof logger.warn === 'function') {
      return {
        info: (message) => logger.info(message),
        warn: (message) => logger.warn(message),
        error: (message) => logger.error(message)
      }
    }
  } catch {
    // An uninjected service read throws; silence is the right degradation.
  }
  return fallback
}

/** The owning session id of an agent payload, or `undefined`. */
function agentSessionId(agent) {
  const id = agent?.session?.header?.id
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

/* ────────────────────────────────────────────────────────────────────────────
 * Wiring
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Mount both arms.
 *
 * `apply` is async only because the harness home helper is imported lazily; it
 * never rejects, and it never assigns onto `ctx`.
 *
 * @param ctx - the host-plane context that receives the listeners.
 * @param config - the row's `config` block.
 */
async function apply(ctx, config) {
  const logger = safeLogger(ctx)
  const resolved = resolveVaultConfig(config)
  if (resolved.enabled === false) {
    logger.info('abaco-vault: disabled by config; no vault and no rewrites')
    return
  }
  const homePathFn = await loadHomePathFn()
  const root = effectiveVaultRoot(resolved, process.env, homePathFn)

  // Best-effort only: an unwritable vault must not stop the plugin from loading.
  try {
    await mkdir(root, { recursive: true, mode: 0o700 })
    logger.info(`abaco-vault: durable artifacts under ${root}`)
  } catch (error) {
    logger.warn(`abaco-vault: vault root ${root} is not writable (${describe(error)}); oversized text will stay inline`)
  }

  /**
   * Vault one settlement notice and return its replacement message, or
   * `undefined` when the message must stay exactly as it is.
   */
  async function rewriteSettledMessage(message, sessionId) {
    try {
      const text = settledMessageText(message)
      if (text === undefined) return undefined
      // Gate: never cut without a vault locator. Order is vault verbatim → then cap.
      const gate = capSettlementOutput(text, { maxBytes: resolved.maxSettledBytes, headLines: resolved.headLines })
      if (gate.kind === 'keep') return undefined
      if (gate.kind !== 'needs-vault') return undefined
      const senderSessionId = message.source?.senderSessionId
      const slug = slugify(`subagent-settled-${typeof senderSessionId === 'string' ? senderSessionId : ''}`, 'subagent-settled')
      const saved = await vaultText({
        root,
        sessionId,
        kind: 'subagent-settled',
        text: gate.text,
        slug,
        extra: typeof senderSessionId === 'string' ? { senderSessionId } : {},
        logger
      })
      const capped = capSettlementOutput(text, {
        maxBytes: resolved.maxSettledBytes,
        headLines: resolved.headLines,
        locator: saved.locator
      })
      if (capped.kind !== 'capped') return undefined
      return withReplacedContent(message, capped.blocks[0].text)
    } catch (error) {
      logger.warn(`abaco-vault: could not vault a settlement notice for session ${sessionId} (${describe(error)}); keeping it inline`)
      return undefined
    }
  }

  // ── Arm A: the settlement-notice hole (design §1.4, §5.2).
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    try {
      if (decision === null || typeof decision !== 'object') return decision
      if (decision.kind === 'reject') return decision
      const messages = decision.messages
      if (!Array.isArray(messages) || messages.length === 0) return decision
      const sessionId = agentSessionId(payload?.agent)
      if (sessionId === undefined) return decision
      const rewritten = []
      let changed = false
      for (const message of messages) {
        const replacement = await rewriteSettledMessage(message, sessionId)
        if (replacement === undefined) rewritten.push(message)
        else {
          rewritten.push(replacement)
          changed = true
        }
      }
      return changed ? { ...decision, messages: rewritten } : decision
    } catch (error) {
      logger.warn(`abaco-vault: settlement rewrite skipped (${describe(error)}); keeping every message inline`)
      return decision
    }
  }, { prepend: true })

  // ── Arm B: durable copies of oversized tool results. Best-effort and
  // deliberately non-rewriting: the stock spill policy owns what the model sees,
  // this arm owns what survives the process.
  if (resolved.vaultToolResults) {
    ctx.on('tools/post-execute', async (exec, result, next) => {
      try {
        const toolName = exec?.name
        if (typeof toolName === 'string' && toolName !== READ_TOOL_NAME && exec?.parent === undefined) {
          const text = flattenPlainText(result?.content)
          if (text !== undefined && utf8Bytes(text) > resolved.vaultInlineChars) {
            const sessionId = agentSessionId(exec?.agent)
            if (sessionId !== undefined) {
              const callId = typeof exec?.callId === 'string' ? exec.callId : undefined
              await vaultText({
                root,
                sessionId,
                kind: 'tool-result',
                text,
                slug: slugify(`${toolName}-${callId ?? ''}`, toolName),
                extra: callId === undefined ? { tool: toolName } : { tool: toolName, callId },
                logger
              })
            }
          }
        }
      } catch (error) {
        // A throwing listener turns a successful tool call into an error
        // (`dsh-tools/lib/index.js:3373`): swallow everything.
        logger.warn(`abaco-vault: could not vault the result of tool "${exec?.name}" (${describe(error)}); keeping it inline`)
      }
      return next()
    }, { prepend: true })
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Cordis surface, plus the seams `test/abaco-vault.test.ts` drives directly.
 *
 * The loader reads only `name`, `inject`, `apply` and `Config`; the extra named
 * exports are what makes the shipped code path testable without a harness.
 * ──────────────────────────────────────────────────────────────────────────── */

export {
  apply,
  artifactFileName,
  capSettlementOutput,
  composeVaultedText,
  flattenPlainText,
  planSettledRewrite,
  renderOmittedNotice,
  settledMessageText,
  slugify,
  utf8Bytes,
  withReplacedContent
}
