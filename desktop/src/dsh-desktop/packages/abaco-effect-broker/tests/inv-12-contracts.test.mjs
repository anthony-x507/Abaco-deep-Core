/**
 * INV-12 merge-blocker gates (Ola 1 Verificación V1).
 * Run: node --test packages/abaco-effect-broker/tests/inv-12-contracts.test.mjs
 * (from desktop/src/dsh-desktop)
 */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  authorize,
  resetBrokerForTests,
  getBrokerStats,
  hashArgs,
} from '../index.js'
import { verifyAudit, audit as provenanceAudit, resetAuditForTests } from '../provenance.js'
import { sealLiveAdmission, resetAdmissionForTests } from '../admission.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = resolve(HERE, '..')
const REPO = resolve(HERE, '..', '..', '..', '..', '..', '..')
const CONTRACT = join(REPO, 'docs', 'contracts', 'CONTRACT-INV-12.md')
const STATUS_PATH = '/api/abaco-voice.local-status'

const DEEP_INV_HOUSES = {
  'INV-AUDIT-CHAIN': ['provenance.js', 'index.js'],
  'INV-DENY-OBSERVED': ['index.js'],
  'INV-TTL-BOUNDED': ['index.js'],
  'INV-NO-WIDEN': ['index.js'],
  'INV-ISOLATION-CLASS': ['index.js'],
  'INV-GRANT-MAP-CAP': ['index.js'],
  'INV-KILL-DRAINS': [join('..', 'abaco-mediacion-pilot', 'ops.js')],
  'INV-DOWNGRADE-HITL': [
    join('..', '..', 'src', 'main', 'state', 'plugin-upgrade-policy.mjs'),
    'compatible-core-policy.mjs',
  ],
  'INV-BOOTSTRAP-SEAL': ['admission.js'],
  'INV-JEV-NEVER-GRANTS': ['index.js'],
  'INV-DURABLE-AUDIT-FAIL-CLOSED': ['index.js'],
}

function readPkg(...rels) {
  return rels.map((r) => readFileSync(join(PKG, r), 'utf8')).join('\n')
}

beforeEach(() => {
  resetBrokerForTests()
  resetAuditForTests()
})

test('INV-12 · contract lists all twelve', () => {
  assert.ok(existsSync(CONTRACT), `missing ${CONTRACT}`)
  const text = readFileSync(CONTRACT, 'utf8')
  for (const name of Object.keys(DEEP_INV_HOUSES)) {
    assert.match(text, new RegExp(name))
  }
  assert.match(text, /INV-SANDBOX-ENV-MIN/)
  assert.match(text, /INV-ISOLATION-CLASS table/)
})

test('INV-12 · each applicable INV marker lives in product code', () => {
  for (const [inv, rels] of Object.entries(DEEP_INV_HOUSES)) {
    const blob = readPkg(...rels)
    assert.match(blob, new RegExp(inv), `${inv} missing from ${rels.join(',')}`)
  }
})

test('INV-AUDIT-CHAIN · provenance verifyAudit fail-closed', () => {
  provenanceAudit({ kind: 'inv12-probe' })
  assert.equal(verifyAudit(), true)
  assert.match(readPkg('provenance.js'), /INV-AUDIT-CHAIN/)
})

test('INV-AUDIT-CHAIN · durable effects.jsonl prev_hash markers', () => {
  const blob = readPkg('provenance.js', 'index.js')
  assert.match(blob, /prev_hash/)
  assert.match(blob, /verifyDurableChain|verifyDurableEffectsFile/)
  assert.match(blob, /sealDurableLine/)
})

test('INV-DENY-OBSERVED · deny increments counter and grows audit', () => {
  const before = getBrokerStats()
  // Unknown / non-admitted effect → deny (auto-grant only covers pinned caps).
  const res = authorize({
    channel: { kind: 'fs.write', path: '/etc/passwd' },
    task_id: null,
    effect: {
      kind: 'fs.write',
      resource: '/etc/passwd',
      args_hash: hashArgs({ op: 'write' }),
    },
    trust_in: 'user',
  })
  assert.equal(res.decision, 'deny')
  const after = getBrokerStats()
  assert.ok(after.denyCount > before.denyCount, 'denyCount must grow')
  assert.ok(after.auditSize > before.auditSize, 'audit must grow')
})

test('INV-BOOTSTRAP-SEAL · sealLiveAdmission export named', () => {
  assert.equal(typeof sealLiveAdmission, 'function')
  assert.equal(typeof resetAdmissionForTests, 'function')
  assert.match(readPkg('admission.js'), /INV-BOOTSTRAP-SEAL/)
})

test('INV-JEV-NEVER-GRANTS · authorize body has no advisor symbols', () => {
  const src = readPkg('index.js')
  const start = src.indexOf('export function authorize(')
  assert.ok(start >= 0)
  const body = src.slice(start, start + 12000)
  assert.doesNotMatch(body, /\bJev\b/)
  assert.doesNotMatch(body, /\batenaAdvise\b/)
  assert.doesNotMatch(body, /from ['"][^'"]*jev/i)
  assert.match(src, /INV-JEV-NEVER-GRANTS/)
})

test('INV-ISOLATION-CLASS · UtilityProcess row for F1-pilot', () => {
  const contract = readFileSync(CONTRACT, 'utf8')
  assert.match(contract, /UtilityProcess/)
  assert.match(readPkg('index.js'), /INV-ISOLATION-CLASS/)
})
