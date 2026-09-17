#!/usr/bin/env node
/**
 * F1.5 MCP schema pin — pin API + wrap + broker consult + candados.
 * Exit 0 only if the suite is green.
 *
 * ESM, only node built-in (child_process). No network.
 */

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const PIN = join(ROOT, 'desktop/src/dsh-desktop/packages/abaco-mcp-schema-pin')

const SUITES = [
  {
    name: 'F1.5 MCP schema pin',
    cmd: 'node',
    args: ['--test', 'tests/schema-pin.test.mjs'],
    cwd: PIN,
  },
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
  const r = spawnSync(s.cmd, s.args, { cwd: s.cwd, encoding: 'utf8', timeout: 120_000 })
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
    console.log('--- salida ---')
    console.log(out.trim())
    console.log('--------------')
  }
}

console.log('')
console.log(`TOTAL: ${totalPass}/${totalTests}  →  ${allGreen ? 'TODO VERDE' : 'HAY ROJO'}`)
process.exit(allGreen ? 0 : 1)
