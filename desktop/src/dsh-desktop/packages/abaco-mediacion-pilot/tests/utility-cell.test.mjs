/**
 * F2.1 Pack B · control-2 strangler cell (utilityProcess / celda).
 *
 * Gates: host survives worker death; unauthorized ops never fork;
 * IPC is {op,args,grantId}; no silent OpenAI fallback; F1 broker +
 * compact lock + disabled-plugin set intact.
 *
 * Run: node --test tests/utility-cell.test.mjs
 * (from desktop/src/dsh-desktop  OR  from this package)
 */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fork } from 'node:child_process'
import {
  authorize,
  resetBrokerForTests,
  issueTaskGrant,
  revokeGrant,
  inspectGrant,
  DISABLED_PLUGINS,
  hashArgs,
} from '../../abaco-effect-broker/index.js'
import {
  executeAuthorized,
  failClosedHint,
  buildWorkerEnv,
  getCellStats,
  resetCellStatsForTests,
  CELL_KIND,
  ALLOWED_OPS,
} from '../index.js'
import { handleMessage, sanitizeInbound, IPC_FIELDS } from '../worker.js'

const THIS_DIR = dirname(fileURLToPath(import.meta.url))
const PKG_DIR = resolve(THIS_DIR, '..')
const DESK = resolve(PKG_DIR, '../..')
const CRASH_WORKER = join(THIS_DIR, 'fixtures/crash-worker.js')
const HANG_WORKER = join(THIS_DIR, 'fixtures/hang-worker.js')
const ECHO_WORKER = join(THIS_DIR, 'fixtures/echo-worker.js')

const VOICE_GRANT = {
  pluginId: 'abaco-voice',
  effects: ['proc.spawn', 'host.fetch', 'fs.write', 'fs.read'],
  resources: [
    'bin:mlx_whisper',
    'bin:ffmpeg',
    '/api/abaco-voice.local-transcribe',
    'fs:tmpdir',
  ],
}

beforeEach(() => {
  resetBrokerForTests()
  resetCellStatsForTests()
})

function liveGrant() {
  return issueTaskGrant(VOICE_GRANT)
}

async function expectRejects(promise, pattern) {
  await assert.rejects(promise, (err) => {
    assert.match(String(err && err.message), pattern)
    return true
  })
}

/* ── B0: honest cell kind ─────────────────────────────────────────────── */

test('B0 CELL_KIND is strangler-fork — does not fake Electron utilityProcess', async () => {
  assert.equal(CELL_KIND, 'strangler-fork')
  const cell = await readFile(join(PKG_DIR, 'CELL.md'), 'utf8')
  const host = await readFile(join(PKG_DIR, 'index.js'), 'utf8')
  const hostCode = host.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.match(cell, /strangler-fork/)
  assert.match(cell, /Do not treat this file as evidence of that API/)
  assert.doesNotMatch(hostCode, /utilityProcess\.fork/)
  assert.match(host, /inspectGrant/)
})

/* ── B1–B3: unauthorized ops denied, 0 fork ───────────────────────────── */

test('B1 sin grantId → deny, 0 fork, contador denied', async () => {
  let forks = 0
  const fakeFork = () => {
    forks += 1
    throw new Error('fork must not run')
  }
  await expectRejects(
    executeAuthorized({ op: 'status', args: {} }, { fork: fakeFork }),
    /requires grantId/,
  )
  assert.equal(forks, 0)
  assert.equal(getCellStats().launched, 0)
  assert.equal(getCellStats().denied, 1)
})

test('B2 grant desconocido / revoked → unauthorized, 0 fork', async () => {
  let forks = 0
  const fakeFork = () => {
    forks += 1
    throw new Error('fork must not run')
  }
  await expectRejects(
    executeAuthorized({ grantId: 'forged-grant', op: 'status', args: {} }, { fork: fakeFork }),
    /unauthorized: unknown-grant/,
  )
  const g = liveGrant()
  revokeGrant(g.grant_id)
  assert.equal(inspectGrant(g.grant_id).live, false)
  assert.equal(inspectGrant(g.grant_id).reason, 'grant-revoked')
  await expectRejects(
    executeAuthorized({ grantId: g.grant_id, op: 'status', args: {} }, { fork: fakeFork }),
    /unauthorized: grant-revoked/,
  )
  assert.equal(forks, 0)
  assert.equal(getCellStats().launched, 0)
  assert.equal(getCellStats().denied, 2)
})

test('B3 op desconocida → unauthorized, 0 fork', async () => {
  let forks = 0
  const g = liveGrant()
  await expectRejects(
    executeAuthorized(
      { grantId: g.grant_id, op: 'rm-rf', args: {} },
      { fork: () => { forks += 1; throw new Error('no') } },
    ),
    /unauthorized: unknown-op/,
  )
  assert.equal(forks, 0)
  assert.ok(ALLOWED_OPS.includes('local-transcribe'))
})

/* ── B4–B5: host survives worker death / timeout ──────────────────────── */

test('B4 worker exit 9 → host vivo; siguiente request deny sigue deny', async () => {
  const parentPid = process.pid
  const g = liveGrant()
  const started = Date.now()
  await expectRejects(
    executeAuthorized(
      { grantId: g.grant_id, op: 'status', args: {}, timeoutMs: 4_000 },
      { workerPath: CRASH_WORKER },
    ),
    /fail-closed/,
  )
  assert.equal(process.pid, parentPid, 'el host (este proceso) debe seguir vivo')
  assert.ok(Date.now() - started < 8_000, 'no debe colgarse el host')
  assert.equal(getCellStats().launched, 1)

  // After crash, unauthorized is still denied (host broker intact).
  await expectRejects(
    executeAuthorized({ grantId: 'nope', op: 'status', args: {} }),
    /unauthorized/,
  )
  const happy = authorize({
    channel: { kind: 'host.fetch', path: '/api/abaco-voice.local-status' },
    task_id: null,
    effect: {
      kind: 'host.fetch',
      resource: '/api/abaco-voice.local-status',
      args_hash: hashArgs({ method: 'GET' }),
    },
    trust_in: 'user',
  })
  assert.equal(happy.decision, 'allow')
})

test('B5 worker hang → timeout fail-closed; host vivo', async () => {
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

/* ── B6: IPC envelope ─────────────────────────────────────────────────── */

test('B6 IPC solo {id,op,args,grantId} — extras del caller no viajan', async () => {
  const g = liveGrant()
  const result = await executeAuthorized(
    {
      grantId: g.grant_id,
      op: 'status',
      args: { ping: 1 },
      timeoutMs: 4_000,
      plugin_id: 'abaco-brand',
      authorize: true,
    },
    { workerPath: ECHO_WORKER },
  )
  assert.deepEqual(result.keys, ['args', 'grantId', 'id', 'op'])
  assert.equal(result.echo.grantId, g.grant_id)
  assert.equal(result.echo.op, 'status')
  assert.equal(result.echo.plugin_id, undefined)
  assert.equal(result.echo.authorize, undefined)
  assert.deepEqual([...IPC_FIELDS].sort(), ['args', 'grantId', 'id', 'op'])
})

test('B6b worker sanitizeInbound drops forged fields; missing grantId refuses work', async () => {
  const clean = sanitizeInbound({
    id: 'j1',
    op: 'status',
    args: { x: 1 },
    grantId: 'g1',
    plugin_id: 'abaco-brand',
    trust_in: 'host',
  })
  assert.deepEqual(Object.keys(clean).sort(), ['args', 'grantId', 'id', 'op'])
  const denied = await handleMessage({ op: 'local-transcribe', args: {} })
  assert.equal(denied.ok, false)
  assert.match(denied.error, /missing grantId/)
})

/* ── B7: no environmental authority ───────────────────────────────────── */

test('B7 worker env strips cloud keys and ELECTRON_RUN_AS_NODE', () => {
  const env = buildWorkerEnv({
    PATH: '/usr/bin',
    HOME: '/tmp',
    OPENAI_API_KEY: 'sk-test',
    OPENAI_API_BASE: 'https://example.invalid',
    DEEPGRAM_API_KEY: 'dg',
    ANTHROPIC_API_KEY: 'ant',
    ELECTRON_RUN_AS_NODE: '1',
    HF_HOME: '/tmp/hf',
  })
  assert.equal(env.OPENAI_API_KEY, undefined)
  assert.equal(env.OPENAI_API_BASE, undefined)
  assert.equal(env.DEEPGRAM_API_KEY, undefined)
  assert.equal(env.ANTHROPIC_API_KEY, undefined)
  assert.equal(env.ELECTRON_RUN_AS_NODE, undefined)
  assert.equal(env.HF_HUB_OFFLINE, '1')
  assert.equal(env.ABACO_CELL, 'mediacion-strangler')
  assert.ok(env.PATH.includes('/usr/bin'))
})

/* ── B8: no silent cloud fallback (source + hint) ─────────────────────── */

test('B8 failClosedHint y fuentes locales no caen a OpenAI', async () => {
  const hint = failClosedHint('boom')
  assert.match(hint, /fail-closed/)
  assert.match(hint, /OpenAI/)
  const voice = await readFile(join(DESK, 'packages/abaco-voice/index.js'), 'utf8')
  assert.match(voice, /failClosedHint/)
  assert.doesNotMatch(voice, /api\.openai\.com/)
  const worker = await readFile(join(PKG_DIR, 'worker.js'), 'utf8')
  const ops = await readFile(join(PKG_DIR, 'ops.js'), 'utf8')
  assert.doesNotMatch(worker, /api\.openai\.com/)
  assert.doesNotMatch(ops, /api\.openai\.com/)
  const client = await readFile(join(DESK, 'packages/abaco-voice/client.js'), 'utf8')
  const localBlockStart = client.indexOf("id: 'local-whisper-stt'")
  const localBlock = client.slice(localBlockStart, client.indexOf('localWhisper.__statusPath', localBlockStart))
  assert.doesNotMatch(localBlock, /api\.openai\.com/)
  assert.match(localBlock, /LOCAL_TRANSCRIBE_PATH/)
})

/* ── B9: inspectGrant is not a grantor ────────────────────────────────── */

test('B9 inspectGrant es read-only; el worker no autoriza', async () => {
  assert.equal(inspectGrant(null).reason, 'missing-grant')
  const g = liveGrant()
  const first = inspectGrant(g.grant_id)
  const second = inspectGrant(g.grant_id)
  assert.equal(first.live, true)
  assert.equal(second.live, true)
  assert.equal(first.grant.grant_id, g.grant_id)
  const worker = await readFile(join(PKG_DIR, 'worker.js'), 'utf8')
  const code = worker
    .split('\n')
    .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//'))
    .join('\n')
  assert.doesNotMatch(code, /\bauthorize\s*\(|issueTaskGrant/)
  const pilot = await readFile(join(PKG_DIR, 'index.js'), 'utf8')
  assert.doesNotMatch(pilot, /issueTaskGrant|broker\.grant/)
})

/* ── B10: compact lock ────────────────────────────────────────────────── */

test('B10 compact lock 0.90 / 0.12 / 8192 intacto', async () => {
  const preset = await readFile(
    join(DESK, 'packages/abaco-context/presets/abaco/agent.cordis.yml'),
    'utf8',
  )
  const row = preset.match(
    /-\s*id:\s*compaction-basic[\s\S]*?thresholdRatio:\s*([0-9.]+)[\s\S]*?retainRatio:\s*([0-9.]+)[\s\S]*?maxTokens:\s*([0-9]+)/,
  )
  assert.ok(row, 'compaction-basic sigue en el preset')
  assert.equal(Number(row[1]), 0.9)
  assert.equal(Number(row[2]), 0.12)
  assert.equal(Number(row[3]), 8192)
})

/* ── B11: plugin-safe / no rehab ──────────────────────────────────────── */

test('B11 disabled plugins siguen disabled; patch lista el piloto', async () => {
  for (const id of [
    'abaco-brand',
    'abaco-device-identity',
    'abaco-cloud-sync',
    'abaco-onboarding',
    'abaco-experimental',
  ]) {
    assert.ok(DISABLED_PLUGINS.has(id), id)
  }
  const patch = await readFile(join(DESK, 'build/dsh-desktop.patch.yml'), 'utf8')
  assert.match(patch, /id: abaco-mediacion-pilot/)
  assert.match(patch, /TEMPORARILY DISABLED/)
  const afterNote = patch.split('TEMPORARILY DISABLED')[1] || ''
  assert.doesNotMatch(afterNote, /- insert:\s*\n\s*- id: abaco-brand/)
})

/* ── B12: naming Janice / Atena ───────────────────────────────────────── */

test('B12 Atena no está en authorize ni en la celda; Janice = runtime', async () => {
  const broker = await readFile(join(DESK, 'packages/abaco-effect-broker/index.js'), 'utf8')
  const authorizeFn = broker.slice(broker.indexOf('export function authorize'))
  assert.doesNotMatch(authorizeFn, /\bAtena\b/)
  const host = await readFile(join(PKG_DIR, 'index.js'), 'utf8')
  const worker = await readFile(join(PKG_DIR, 'worker.js'), 'utf8')
  for (const src of [host, worker]) {
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    assert.doesNotMatch(code, /\bAtena\b/)
  }
})

/* ── B13: real fork still uses node:child_process (strangler) ─────────── */

test('B13 executeAuthorized usa fork real (child_process), no un stub vacío', async () => {
  const g = liveGrant()
  const child = fork(ECHO_WORKER, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
  assert.ok(child.pid)
  child.kill()
  const result = await executeAuthorized(
    { grantId: g.grant_id, op: 'status', args: { ok: true }, timeoutMs: 4_000 },
    { workerPath: ECHO_WORKER },
  )
  assert.equal(result.ok, true)
  assert.equal(result.echo.op, 'status')
})
