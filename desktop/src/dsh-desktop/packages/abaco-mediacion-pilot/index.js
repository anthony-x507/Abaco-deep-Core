/**
 * abaco-mediacion-pilot — Janice (runtime) host fiber (executor cell).
 * Does NOT own voice routes. Does NOT issue grants.
 * Control-2 cell: explicit STRANGLER (child_process.fork). See CELL.md.
 * Electron utilityProcess is main-process-only (launchDisclaimedUtilityProcess
 * isolates the Harness host). This fiber runs inside that host and cannot
 * call utilityProcess.fork — we do not fake that API.
 *
 * IPC envelope after a live grant: {op,args,grantId} + correlator `id`.
 *
 * @module abaco-mediacion-pilot
 */

import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { inspectGrant } from '../abaco-effect-broker/index.js'
import { installMcpRegisterWitness } from '../abaco-mcp-schema-pin/index.js'

export const name = 'abaco-mediacion-pilot'

/**
 * Tools inject so F1.5 can wrap the shared `ctx.tools.register` (MCP
 * schema pin). Still not a grantor. Voice still owns fetch routes.
 */
export const inject = ['tools']

/** Honest cell kind — strangler-fork, not a pretend Electron utilityProcess. */
export const CELL_KIND = 'strangler-fork'

export const ALLOWED_OPS = Object.freeze(['local-transcribe', 'status'])

const __dirname = dirname(fileURLToPath(import.meta.url))
const WORKER = join(__dirname, 'worker.js')

const ENV_STRIP_EXACT = new Set([
  'OPENAI_API_KEY',
  'OPENAI_API_BASE',
  'OPENAI_ORGANIZATION',
  'DEEPGRAM_API_KEY',
  'ELEVENLABS_API_KEY',
  'ANTHROPIC_API_KEY',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_ACCESS_KEY_ID',
  'AWS_SESSION_TOKEN',
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'NPM_TOKEN',
  'ELECTRON_RUN_AS_NODE',
])

const ENV_STRIP_PREFIX = /^(OPENAI|DEEPGRAM|ELEVEN|ANTHROPIC|AZURE_OPENAI)_/i

let cellDenied = 0
let cellLaunched = 0

export function getCellStats() {
  return { denied: cellDenied, launched: cellLaunched }
}

export function resetCellStatsForTests() {
  cellDenied = 0
  cellLaunched = 0
}

/**
 * Worker env: no cloud keys, no Electron-as-Node. HOME/PATH kept so local
 * whisper can see HF cache + bins. Worker has no environmental authority.
 */
export function buildWorkerEnv(baseEnv = process.env) {
  const env = {}
  for (const [key, value] of Object.entries(baseEnv || {})) {
    if (value == null) continue
    if (ENV_STRIP_EXACT.has(key)) continue
    if (ENV_STRIP_PREFIX.test(key)) continue
    env[key] = value
  }
  env.PATH = ['/opt/homebrew/bin', '/usr/local/bin', env.PATH || ''].join(':')
  env.HF_HUB_OFFLINE = '1'
  env.TRANSFORMERS_OFFLINE = '1'
  env.ABACO_CELL = 'mediacion-strangler'
  return env
}

export function failClosedHint(error) {
  const msg = error instanceof Error ? error.message : String(error || 'cell failed')
  if (msg.includes('fail-closed')) return msg
  return `${msg} Local STT fail-closed (celda strangler). No hay fallback silencioso a OpenAI/cloud.`
}

function denyCell(reason) {
  cellDenied += 1
  return Promise.reject(new Error(reason))
}

/**
 * Run an already-authorized op in the strangler cell.
 * @param {{ grantId: string, op: string, args: Record<string, unknown>, timeoutMs?: number }} req
 * @param {{ fork?: typeof fork, workerPath?: string, env?: NodeJS.ProcessEnv }} [opts]
 */
export function executeAuthorized(req, opts = {}) {
  if (!req || !req.grantId) {
    return denyCell('executeAuthorized requires grantId (worker is not a grantor)')
  }
  const inspected = inspectGrant(req.grantId)
  if (!inspected.live) {
    return denyCell(`unauthorized: ${inspected.reason}`)
  }
  if (!ALLOWED_OPS.includes(req.op)) {
    return denyCell('unauthorized: unknown-op')
  }

  const forkImpl = typeof opts.fork === 'function' ? opts.fork : fork
  const workerPath = opts.workerPath || WORKER
  const env = buildWorkerEnv(opts.env || process.env)

  return new Promise((resolve, reject) => {
    cellLaunched += 1
    const child = forkImpl(workerPath, [], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env,
    })
    const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* already gone */ }
      finish(new Error(failClosedHint('mediation worker timeout')))
    }, req.timeoutMs || 120_000)

    let settled = false
    const finish = (err, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { child.kill() } catch { /* already gone */ }
      if (err) reject(err)
      else resolve(value)
    }

    child.on('message', (msg) => {
      if (msg && msg.ready) {
        // Contract envelope: {op,args,grantId} plus correlator id only.
        child.send({
          id,
          grantId: req.grantId,
          op: req.op,
          args: req.args && typeof req.args === 'object' ? { ...req.args } : {},
        })
        return
      }
      if (msg && msg.id === id) {
        if (msg.ok) finish(null, msg)
        else finish(new Error(failClosedHint(msg.error || 'worker failed')))
      }
    })
    child.on('error', (e) => finish(new Error(failClosedHint(e))))
    child.on('exit', (code, signal) => {
      if (!settled) {
        finish(new Error(failClosedHint(`worker exited (${signal || (code ?? 0)})`)))
      }
    })
  })
}

/**
 * Host apply — no routes, no grants. Installs the F1.5 MCP register witness
 * on the shared tools service so later mcp-client `ctx.tools.register`
 * calls fail closed unless the schema is pinned. Janice = runtime.
 */
export function apply(ctx) {
  installMcpRegisterWitness(ctx)
}
