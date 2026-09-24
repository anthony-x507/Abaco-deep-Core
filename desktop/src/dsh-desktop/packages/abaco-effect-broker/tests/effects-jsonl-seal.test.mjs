/**
 * Ola 2 / Bloque 2.A — on-disk effects.jsonl prev_hash + verify fail-closed
 * (INV-AUDIT-CHAIN residual / GAP V1 2026-09-23).
 *
 * Parity with in-memory provenance.audit / verifyAudit.
 * Does NOT weaken INV-DURABLE-AUDIT-FAIL-CLOSED.
 *
 * Run: node --test packages/abaco-effect-broker/tests/effects-jsonl-seal.test.mjs
 * (from desktop/src/dsh-desktop)
 */
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  authorize,
  resetBrokerForTests,
  hashArgs,
  setDurableAppendForTests,
  getDurableEffectsPath,
  verifyDurableEffectsOnDisk,
  isDurableAuditUnavailable,
  DURABLE_AUDIT_FAIL_THRESHOLD,
  getDurableAuditStatus,
  DURABLE_GENESIS,
  sealDurableLine,
  verifyDurableLine,
  verifyDurableChain,
  verifyDurableEffectsFile,
  setGrantMapLimitsForTests,
} from '../index.js'

const THIS_DIR = dirname(fileURLToPath(import.meta.url))
const PKG_DIR = resolve(THIS_DIR, '..')
const STATUS_PATH = '/api/abaco-voice.local-status'

let tmpHome = null
let prevDshHome = undefined

beforeEach(() => {
  resetBrokerForTests()
  tmpHome = mkdtempSync(join(tmpdir(), 'abaco-ola2a-'))
  prevDshHome = process.env.DSH_HOME
  process.env.DSH_HOME = tmpHome
  setDurableAppendForTests(null)
})

afterEach(() => {
  if (prevDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = prevDshHome
  if (tmpHome && existsSync(tmpHome)) {
    try {
      rmSync(tmpHome, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
  resetBrokerForTests()
})

function voiceStatusReq(extra = {}) {
  return {
    channel: { kind: 'host.fetch', path: STATUS_PATH },
    task_id: null,
    effect: {
      kind: 'host.fetch',
      resource: STATUS_PATH,
      args_hash: hashArgs({ method: 'GET' }),
    },
    trust_in: 'user',
    ...extra,
  }
}

test('OLA2-A · sealDurableLine emits prev_hash + 64-hex hash', () => {
  const a = sealDurableLine({
    seq: 0,
    entry: { kind: 'probe' },
    prev_hash: DURABLE_GENESIS,
  })
  assert.equal(a.seq, 0)
  assert.equal(a.prev_hash, DURABLE_GENESIS)
  assert.match(a.hash, /^[0-9a-f]{64}$/)
  assert.equal(verifyDurableLine(a), true)
})

test('OLA2-A · verifyDurableChain links prev_hash; tamper fail-closed', () => {
  const a = sealDurableLine({ seq: 0, entry: { n: 1 }, prev_hash: DURABLE_GENESIS })
  const b = sealDurableLine({ seq: 1, entry: { n: 2 }, prev_hash: a.hash })
  assert.equal(verifyDurableChain([a, b]), true)

  const tampered = { ...b, entry: { n: 999 } }
  assert.equal(verifyDurableLine(tampered), false)
  assert.equal(verifyDurableChain([a, tampered]), false)

  const forgedLink = { ...b, prev_hash: 'f'.repeat(64) }
  assert.equal(verifyDurableLine(forgedLink), false)
  assert.equal(verifyDurableChain([a, forgedLink]), false)

  assert.equal(verifyDurableChain(null), false)
  assert.equal(verifyDurableEffectsFile('{not-json\n'), false)
})

test('OLA2-A · authorize durable sink writes sealed effects.jsonl', () => {
  assert.equal(authorize(voiceStatusReq()).decision, 'allow')
  assert.equal(authorize(voiceStatusReq()).decision, 'allow')

  const path = getDurableEffectsPath()
  assert.ok(path)
  assert.ok(existsSync(path), 'effects.jsonl must exist under DSH_HOME')
  const text = readFileSync(path, 'utf8')
  assert.equal(verifyDurableEffectsFile(text), true)
  assert.equal(verifyDurableEffectsOnDisk(), true)

  const lines = text.trim().split('\n')
  assert.ok(lines.length >= 2)
  const r0 = JSON.parse(lines[0])
  const r1 = JSON.parse(lines[1])
  assert.equal(r0.prev_hash, DURABLE_GENESIS)
  assert.equal(r1.prev_hash, r0.hash)
  assert.equal(typeof r0.entry, 'object')
  assert.match(r0.hash, /^[0-9a-f]{64}$/)
})

test('OLA2-A · on-disk tamper → verifyDurableEffectsOnDisk false', () => {
  authorize(voiceStatusReq())
  authorize(voiceStatusReq())
  const path = getDurableEffectsPath()
  const lines = readFileSync(path, 'utf8').trim().split('\n')
  const rec = JSON.parse(lines[1])
  rec.entry = { ...rec.entry, decision: 'forged-allow' }
  lines[1] = JSON.stringify(rec)
  writeFileSync(path, lines.join('\n') + '\n')
  assert.equal(verifyDurableEffectsOnDisk(path), false)
  assert.equal(verifyDurableEffectsFile(readFileSync(path, 'utf8')), false)
})

test('OLA2-A · corrupt existing file → durable failures → audit-unavailable', () => {
  const path = getDurableEffectsPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(
    path,
    JSON.stringify({ seq: 0, entry: { bad: true }, prev_hash: 'nope', hash: '00' }) + '\n',
  )

  resetBrokerForTests()
  process.env.DSH_HOME = tmpHome
  setDurableAppendForTests(null)

  let guard = 0
  while (!isDurableAuditUnavailable() && guard < DURABLE_AUDIT_FAIL_THRESHOLD + 10) {
    authorize(voiceStatusReq())
    guard += 1
  }
  assert.equal(isDurableAuditUnavailable(), true)
  assert.ok(getDurableAuditStatus().failureTotal >= DURABLE_AUDIT_FAIL_THRESHOLD)
  assert.match(String(getDurableAuditStatus().lastError || ''), /durable-effects-chain-invalid/)

  const denied = authorize(voiceStatusReq())
  assert.equal(denied.decision, 'deny')
  assert.equal(denied.reason, 'audit-unavailable')
})

test('OLA2-A · parallel writers under shared path keep chain valid (lock)', async () => {
  // Mirrors Desktop CI: multiple node --test workers share HOME and append
  // concurrently. Exclusive lock keeps the hash-chain contiguous.
  const { spawn } = await import('node:child_process')
  const { once } = await import('node:events')
  const indexPath = join(PKG_DIR, 'index.js')
  const workerSrc = `
    import {
      authorize, resetBrokerForTests, hashArgs, setDurableAppendForTests,
      setGrantMapLimitsForTests,
    } from ${JSON.stringify(indexPath)};
    resetBrokerForTests();
    setDurableAppendForTests(null);
    setGrantMapLimitsForTests(64, 1000);
    const STATUS = '/api/abaco-voice.local-status';
    const req = () => ({
      channel: { kind: 'host.fetch', path: STATUS },
      task_id: null,
      effect: { kind: 'host.fetch', resource: STATUS, args_hash: hashArgs({ method: 'GET' }) },
      trust_in: 'user',
    });
    for (let i = 0; i < 10; i++) {
      const d = authorize(req());
      if (d.decision !== 'allow') {
        console.error('deny', d.reason);
        process.exit(2);
      }
    }
  `
  const kids = []
  for (let i = 0; i < 3; i++) {
    kids.push(
      spawn(process.execPath, ['--input-type=module', '-e', workerSrc], {
        env: { ...process.env, DSH_HOME: tmpHome },
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    )
  }
  const codes = await Promise.all(
    kids.map(async (kid) => {
      const [code] = await once(kid, 'exit')
      return code
    }),
  )
  assert.deepEqual(codes, [0, 0, 0], `worker exit codes ${codes}`)
  assert.equal(verifyDurableEffectsOnDisk(getDurableEffectsPath()), true)
  const lines = readFileSync(getDurableEffectsPath(), 'utf8').trim().split('\n')
  assert.equal(lines.length, 30)
})

test('OLA2-A · product markers present (INV-AUDIT-CHAIN file seal)', () => {
  const provenance = readFileSync(join(PKG_DIR, 'provenance.js'), 'utf8')
  const index = readFileSync(join(PKG_DIR, 'index.js'), 'utf8')
  assert.match(provenance, /INV-AUDIT-CHAIN/)
  assert.match(provenance, /prev_hash/)
  assert.match(provenance, /verifyDurableChain/)
  assert.match(index, /Ola 2 \/ Bloque 2\.A/)
  assert.match(index, /prev_hash/)
  assert.match(index, /INV-DURABLE-AUDIT-FAIL-CLOSED/)
})
