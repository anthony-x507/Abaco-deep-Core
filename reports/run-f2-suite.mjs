#!/usr/bin/env node
/**
 * F2-W6 · run-f2-suite.mjs — corre TODA la suite F1+F2 y sale 0 solo si todo
 * está verde.
 *
 * Suites:
 *   1. F1 histórica (vitest, test/abaco-f1-mediacion-broker.test.ts) — SIN TOCAR
 *   2-6. node --test: cascade, breakers, provenance, tiers (broker) + threat-model (memory)
 *   7. node --test: f2-integration (cableado W6)
 *
 * ESM, solo node built-in (child_process). Sin npm, sin red.
 */

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url))) // F2-WORK/
const DESK = join(ROOT, 'desktop/src/dsh-desktop')

const SUITES = [
  {
    name: 'F1 histórica (vitest)',
    cmd: './node_modules/.bin/vitest',
    args: ['run', 'test/abaco-f1-mediacion-broker.test.ts'],
    cwd: DESK,
  },
  { name: 'F2-W1 cascada', cmd: 'node', args: ['--test', 'packages/abaco-effect-broker/tests/cascade.test.mjs'], cwd: DESK },
  { name: 'F2-W2 breakers', cmd: 'node', args: ['--test', 'packages/abaco-effect-broker/tests/breakers.test.mjs'], cwd: DESK },
  { name: 'F2-W3 provenance', cmd: 'node', args: ['--test', 'packages/abaco-effect-broker/tests/provenance.test.mjs'], cwd: DESK },
  { name: 'F2-W4 tiers', cmd: 'node', args: ['--test', 'packages/abaco-effect-broker/tests/tiers.test.mjs'], cwd: DESK },
  { name: 'F2-W5 threat-model', cmd: 'node', args: ['--test', 'packages/abaco-memory/tests/threat-model.test.mjs'], cwd: DESK },
  { name: 'F2-W6 integración', cmd: 'node', args: ['--test', 'packages/abaco-effect-broker/tests/f2-integration.test.mjs'], cwd: DESK },
]

function parseCounts(rawOut) {
  const out = rawOut.replace(/\[[0-9;]*m/g, '')
  // vitest: "Test Files  1 passed" + "Tests  12 passed" — chequear primero.
  if (/Test Files/.test(out)) {
    const vp = out.match(/Tests\s+(\d+)\s+passed/)
    const vfailed = out.match(/(\d+)\s+failed/)
    if (vp) {
      const fail = vfailed ? +vfailed[1] : 0
      const pass = +vp[1]
      return { tests: pass + fail, pass, fail }
    }
    return null
  }
  // node --test: "ℹ tests 13 / ℹ pass 13 / ℹ fail 0"
  const t = out.match(/tests\s+(\d+)/)
  const p = out.match(/pass\s+(\d+)/)
  const f = out.match(/fail\s+(\d+)/)
  if (t && p && f) return { tests: +t[1], pass: +p[1], fail: +f[1] }
  return null
}

let allGreen = true
let totalTests = 0
let totalPass = 0
const rows = []

for (const s of SUITES) {
  const r = spawnSync(s.cmd, s.args, { cwd: s.cwd, encoding: 'utf8', timeout: 300_000 })
  const out = (r.stdout || '') + (r.stderr || '')
  const counts = parseCounts(out)
  const ok = r.status === 0 && counts && counts.fail === 0 && counts.pass === counts.tests && counts.tests > 0
  if (!ok) allGreen = false
  if (counts) {
    totalTests += counts.tests
    totalPass += counts.pass
  }
  rows.push({ name: s.name, ok, counts, status: r.status })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${s.name}  ${counts ? `${counts.pass}/${counts.tests} (fail ${counts.fail})` : '(sin conteo)'}  exit=${r.status}`)
  if (!ok) {
    console.log('--- salida (últimas 25 líneas) ---')
    console.log(out.trim().split('\n').slice(-25).join('\n'))
    console.log('----------------------------------')
  }
}

console.log('')
console.log(`TOTAL: ${totalPass}/${totalTests}  →  ${allGreen ? 'TODO VERDE' : 'HAY ROJO'}`)
process.exit(allGreen ? 0 : 1)
