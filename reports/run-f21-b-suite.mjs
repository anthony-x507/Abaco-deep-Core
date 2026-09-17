#!/usr/bin/env node
/**
 * F2.1 Pack B — run F1 + F2 + Pack A quarantine + Pack B cell suites.
 * Exit 0 only if every suite is green.
 *
 * ESM, only node built-in (child_process). No network.
 */

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const DESK = join(ROOT, 'desktop/src/dsh-desktop')
const PILOT = join(DESK, 'packages/abaco-mediacion-pilot')

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
  { name: 'F2.1-A quarantine', cmd: 'node', args: ['--test', 'packages/abaco-memory/tests/quarantine.test.mjs'], cwd: DESK },
  { name: 'F2.1-B utility-cell', cmd: 'node', args: ['--test', 'tests/utility-cell.test.mjs'], cwd: PILOT },
]

function parseCounts(rawOut) {
  const out = rawOut.replace(/\u001b\[[0-9;]*m/g, '')
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
  const t = out.match(/tests\s+(\d+)/)
  const p = out.match(/pass\s+(\d+)/)
  const f = out.match(/fail\s+(\d+)/)
  if (t && p && f) return { tests: +t[1], pass: +p[1], fail: +f[1] }
  return null
}

let allGreen = true
let totalTests = 0
let totalPass = 0

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
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${s.name}  ${counts ? `${counts.pass}/${counts.tests} (fail ${counts.fail})` : '(sin conteo)'}  exit=${r.status}`)
  if (!ok) {
    console.log('--- salida (últimas 40 líneas) ---')
    console.log(out.trim().split('\n').slice(-40).join('\n'))
    console.log('----------------------------------')
  }
}

console.log('')
console.log(`TOTAL: ${totalPass}/${totalTests}  →  ${allGreen ? 'TODO VERDE' : 'HAY ROJO'}`)
process.exit(allGreen ? 0 : 1)
