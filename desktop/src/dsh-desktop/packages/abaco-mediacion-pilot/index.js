/**
 * abaco-mediacion-pilot — Janice host fiber (executor cell).
 * Does NOT own voice routes. Does NOT issue grants.
 * Forks worker for authorized local-transcribe only.
 *
 * @module abaco-mediacion-pilot
 */

import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

export const name = 'abaco-mediacion-pilot'

/** No connection inject — executor only; voice owns fetch routes. */
export const inject = []

const __dirname = dirname(fileURLToPath(import.meta.url))
const WORKER = join(__dirname, 'worker.js')

/**
 * Run an already-authorized op in a child process cell.
 * @param {{ grantId: string, op: string, args: Record<string, unknown>, timeoutMs?: number }} req
 */
export function executeAuthorized(req) {
  if (!req || !req.grantId) {
    return Promise.reject(new Error('executeAuthorized requires grantId (worker is not a grantor)'))
  }
  return new Promise((resolve, reject) => {
    const child = fork(WORKER, [], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: {
        ...process.env,
        PATH: ['/opt/homebrew/bin', '/usr/local/bin', process.env.PATH || ''].join(':'),
      },
    })
    const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch {}
      reject(new Error('mediation worker timeout'))
    }, req.timeoutMs || 120_000)

    let settled = false
    const finish = (err, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { child.kill() } catch {}
      if (err) reject(err)
      else resolve(value)
    }

    child.on('message', (msg) => {
      if (msg && msg.ready) {
        child.send({
          id,
          grantId: req.grantId,
          op: req.op,
          args: req.args || {},
        })
        return
      }
      if (msg && msg.id === id) {
        if (msg.ok) finish(null, msg)
        else finish(new Error(msg.error || 'worker failed'))
      }
    })
    child.on('error', (e) => finish(e))
    child.on('exit', (code) => {
      if (!settled && code && code !== 0) finish(new Error(`worker exit ${code}`))
    })
  })
}

/** Host apply — no routes, no grants. Presence in patch.yml only. */
export function apply() {}
