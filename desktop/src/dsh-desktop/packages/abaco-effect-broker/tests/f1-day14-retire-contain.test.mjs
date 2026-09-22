/**
 * F1 day-14 · plugin piloto retirable + contención (crash/block/OOM) + face mínima.
 *
 * Lives under abaco-effect-broker/tests so F1.5 G9.3 stay-out (memory packager
 * must not add piloto-tree files) stays green. Imports the Janice cell only.
 *
 * Run: node --test packages/abaco-effect-broker/tests/f1-day14-retire-contain.test.mjs
 * (from desktop/src/dsh-desktop)
 */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, access } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  authorize,
  resetBrokerForTests,
  issueTaskGrant,
  revokeGrant,
  inspectGrant,
  hashArgs,
} from '../index.js'
import {
  executeAuthorized,
  getCellStats,
  resetCellStatsForTests,
  CELL_KIND,
  apply as applyPilot,
} from '../../abaco-mediacion-pilot/index.js'

const THIS_DIR = dirname(fileURLToPath(import.meta.url))
const DESK = resolve(THIS_DIR, '../../..')
const PILOT_DIR = join(DESK, 'packages/abaco-mediacion-pilot')
const PILOT_FIXTURES = join(PILOT_DIR, 'tests/fixtures')
const OOM_WORKER = join(THIS_DIR, 'fixtures/oom-worker.js')
const CRASH_WORKER = join(PILOT_FIXTURES, 'crash-worker.js')
const HANG_WORKER = join(PILOT_FIXTURES, 'hang-worker.js')
const ECHO_WORKER = join(PILOT_FIXTURES, 'echo-worker.js')
const STATUS_PATH = '/api/abaco-voice.local-status'

const VOICE_GRANT = {
  pluginId: 'abaco-voice',
  effects: ['proc.spawn', 'host.fetch', 'fs.write', 'fs.read'],
  resources: [
    'bin:mlx_whisper',
    'bin:ffmpeg',
    '/api/abaco-voice.local-transcribe',
    '/api/abaco-voice.local-status',
    'fs:tmpdir',
  ],
}

beforeEach(() => {
  resetBrokerForTests()
  resetCellStatsForTests()
})

async function expectRejects(promise, pattern) {
  await assert.rejects(promise, (err) => {
    assert.match(String(err && err.message), pattern)
    return true
  })
}

function liveGrant() {
  return issueTaskGrant(VOICE_GRANT)
}

test('D14-T1 piloto retirable: revoke + no fork + host PID intact + broker still authorizes', async () => {
  const parentPid = process.pid
  const g = liveGrant()
  const ok = await executeAuthorized(
    { grantId: g.grant_id, op: 'status', args: { ping: 1 }, timeoutMs: 4_000 },
    { workerPath: ECHO_WORKER },
  )
  assert.equal(ok.ok, true)

  const t0 = Date.now()
  assert.equal(revokeGrant(g.grant_id), true)
  assert.equal(inspectGrant(g.grant_id).live, false)

  let forks = 0
  await expectRejects(
    executeAuthorized(
      { grantId: g.grant_id, op: 'status', args: {} },
      { fork: () => { forks += 1; throw new Error('retired cell must not fork') } },
    ),
    /unauthorized: grant-revoked/,
  )
  const elapsed = Date.now() - t0
  assert.equal(forks, 0)
  assert.equal(process.pid, parentPid, 'retirar el piloto no reinicia el núcleo')
  assert.ok(elapsed <= 1000, `revoke→cell-deny took ${elapsed}ms`)
  assert.equal(getCellStats().denied, 1)

  const happy = authorize({
    channel: { kind: 'host.fetch', path: STATUS_PATH },
    task_id: null,
    effect: {
      kind: 'host.fetch',
      resource: STATUS_PATH,
      args_hash: hashArgs({ method: 'GET' }),
    },
    trust_in: 'user',
  })
  assert.equal(happy.decision, 'allow')
})

test('D14-T2 apply() del piloto no registra rutas ni emite grants (face mínima)', async () => {
  const registry = []
  const tools = { register: () => {} }
  applyPilot({
    connection: { fetch: { register: (entry) => { registry.push(entry) } } },
    tools,
  })
  assert.deepEqual(registry, [], 'piloto no es dueño de host.fetch')
})

test('D14-T3 face/uso mínimo: no client.js, no issueTaskGrant, no Atena, no utilityProcess fake', async () => {
  assert.equal(CELL_KIND, 'strangler-fork')
  await assert.rejects(access(join(PILOT_DIR, 'client.js'), fsConstants.F_OK), /ENOENT/)
  const host = await readFile(join(PILOT_DIR, 'index.js'), 'utf8')
  const worker = await readFile(join(PILOT_DIR, 'worker.js'), 'utf8')
  const hostCode = host.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const workerCode = worker
    .split('\n')
    .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//'))
    .join('\n')
  assert.doesNotMatch(host, /issueTaskGrant|broker\.grant/)
  assert.doesNotMatch(workerCode, /\bauthorize\s*\(|issueTaskGrant/)
  assert.doesNotMatch(hostCode, /utilityProcess\.fork/)
  assert.doesNotMatch(hostCode, /\bAtena\b/)
  assert.doesNotMatch(workerCode, /\bAtena\b/)
  assert.match(host, /Janice = runtime/)
})

test('D14-K1 crash worker (exit 9) no mata el host; siguiente deny sigue deny', async () => {
  const parentPid = process.pid
  const g = liveGrant()
  await expectRejects(
    executeAuthorized(
      { grantId: g.grant_id, op: 'status', args: {}, timeoutMs: 4_000 },
      { workerPath: CRASH_WORKER },
    ),
    /fail-closed/,
  )
  assert.equal(process.pid, parentPid)
  await expectRejects(
    executeAuthorized({ grantId: 'nope', op: 'status', args: {} }),
    /unauthorized/,
  )
})

test('D14-K2 hang worker → timeout fail-closed; host vivo', async () => {
  const parentPid = process.pid
  const g = liveGrant()
  await expectRejects(
    executeAuthorized(
      { grantId: g.grant_id, op: 'status', args: {}, timeoutMs: 400 },
      { workerPath: HANG_WORKER },
    ),
    /timeout[\s\S]*fail-closed/,
  )
  assert.equal(process.pid, parentPid)
})

test('D14-K3 OOM-killer simulation (SIGKILL) no reinicia el host', async () => {
  const parentPid = process.pid
  const g = liveGrant()
  const started = Date.now()
  await expectRejects(
    executeAuthorized(
      { grantId: g.grant_id, op: 'status', args: {}, timeoutMs: 4_000 },
      { workerPath: OOM_WORKER },
    ),
    /fail-closed/,
  )
  assert.equal(process.pid, parentPid, 'SIGKILL del worker no tumba el host')
  assert.ok(Date.now() - started < 8_000)
  const happy = authorize({
    channel: { kind: 'host.fetch', path: STATUS_PATH },
    task_id: null,
    effect: {
      kind: 'host.fetch',
      resource: STATUS_PATH,
      args_hash: hashArgs({ method: 'GET' }),
    },
    trust_in: 'user',
  })
  assert.equal(happy.decision, 'allow')
})

test('D14-K4 voice host still authorize→executeAuthorized; no direct spawn', async () => {
  const voice = await readFile(join(DESK, 'packages/abaco-voice/index.js'), 'utf8')
  assert.match(voice, /authorize\(/)
  assert.match(voice, /executeAuthorized/)
  assert.match(voice, /proc\.spawn/)
  const code = voice.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.doesNotMatch(code, /\bspawn\s*\(/)
  const transcribe = voice.slice(voice.indexOf('LOCAL_TRANSCRIBE_PATH'))
  const spawnIdx = transcribe.indexOf("kind: 'proc.spawn'")
  const execIdx = transcribe.indexOf('executeAuthorized')
  assert.ok(spawnIdx > 0 && execIdx > spawnIdx, 'authorize(proc.spawn) must precede executeAuthorized')
})
