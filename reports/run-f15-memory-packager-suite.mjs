#!/usr/bin/env node
/**
 * F1.5 memory 3-phase packager provenance — run packager gates + Pack A
 * quarantine (candado) + F2-W5 threat-model + F1 admission G4-adjacent.
 * Exit 0 only if every suite that can run is green.
 *
 * Does NOT run the MCP pin suite (PR #16 / reports/run-f15-suite.mjs).
 *
 * ESM, only node built-in (child_process). No network.
 */

import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const DESK = join(ROOT, 'desktop/src/dsh-desktop')

const SUITES = [
  {
    name: 'F1.5 memory packager provenance',
    cmd: 'node',
    args: ['--test', 'packages/abaco-memory/tests/packager-provenance.test.mjs'],
    cwd: DESK
  },
  {
    name: 'F2.1-A quarantine (candado)',
    cmd: 'node',
    args: ['--test', 'packages/abaco-memory/tests/quarantine.test.mjs'],
    cwd: DESK
  },
  {
    name: 'F2-W5 threat-model',
    cmd: 'node',
    args: ['--test', 'packages/abaco-memory/tests/threat-model.test.mjs'],
    cwd: DESK
  }
]

function parseCounts(rawOut) {
  const out = rawOut.replace(/\u001b\[[0-9;]*m/g, '')
  const t = out.match(/# tests\s+(\d+)/) || out.match(/tests\s+(\d+)/)
  const p = out.match(/# pass\s+(\d+)/) || out.match(/pass\s+(\d+)/)
  const f = out.match(/# fail\s+(\d+)/) || out.match(/fail\s+(\d+)/)
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
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${s.name}  ${counts ? `${counts.pass}/${counts.tests} (fail ${counts.fail})` : '(sin conteo)'}  exit=${r.status}`
  )
  if (!ok) {
    console.log('--- salida (últimas 40 líneas) ---')
    console.log(out.trim().split('\n').slice(-40).join('\n'))
    console.log('----------------------------------')
  }
}

console.log('')
console.log(`TOTAL: ${totalPass}/${totalTests}  →  ${allGreen ? 'TODO VERDE' : 'HAY ROJO'}`)
process.exit(allGreen ? 0 : 1)
