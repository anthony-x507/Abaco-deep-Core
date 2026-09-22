/**
 * F1 day-14 · fail-closed + A_efectiva intersection + revoke ≤1s + stay-out.
 *
 * Locks CONTRACT-F1-MEDIACION-DEEP day-14 criteria that can run without
 * Electron GUI. Broker product code is not re-implemented here — these
 * tests pin current authorize() behavior.
 *
 * Run: node --test packages/abaco-effect-broker/tests/f1-day14-fail-closed.test.mjs
 * (from desktop/src/dsh-desktop)
 */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdir, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import {
  authorize,
  resetBrokerForTests,
  getBrokerStats,
  getAuditLog,
  issueTaskGrant,
  revokeGrant,
  inspectGrant,
  resolveIdentity,
  DISABLED_PLUGINS,
  ADMISSION_ROLES,
  hashArgs,
} from '../index.js'

const THIS_DIR = dirname(fileURLToPath(import.meta.url))
const PKG_DIR = resolve(THIS_DIR, '..')
const DESK = resolve(PKG_DIR, '../..')
const REPO = resolve(DESK, '../../..')
const STATUS_PATH = '/api/abaco-voice.local-status'
const TRANSCRIBE_PATH = '/api/abaco-voice.local-transcribe'

beforeEach(() => {
  resetBrokerForTests()
})

function voiceGrant(over = {}) {
  return issueTaskGrant({
    pluginId: 'abaco-voice',
    effects: ['proc.spawn', 'host.fetch', 'fs.write', 'fs.read'],
    resources: [
      'bin:mlx_whisper',
      'bin:ffmpeg',
      TRANSCRIBE_PATH,
      STATUS_PATH,
      'fs:tmpdir',
    ],
    ...over,
  })
}

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

function assertDenyQuartet(decision, reason) {
  assert.equal(decision.decision, 'deny')
  assert.equal(decision.reason, reason)
  const last = decision.audit || getAuditLog()[getAuditLog().length - 1]
  assert.equal(last.decision, 'deny')
  assert.equal(last.side_effect, false)
  assert.equal(last.reason, reason)
  assert.ok(last.trace_id)
  assert.ok(getBrokerStats().denyCount > 0)
}

/* ── D14-Q: fail-closed quartet ───────────────────────────────────────── */

test('D14-Q deny · 0 side-effect · audit · contador (no-identity)', () => {
  const before = getBrokerStats()
  const d = authorize({
    channel: null,
    task_id: null,
    effect: { kind: 'proc.spawn', resource: 'bin:mlx_whisper', args_hash: 'x' },
    trust_in: 'user',
  })
  assertDenyQuartet(d, 'no-identity')
  assert.equal(getBrokerStats().denyCount, before.denyCount + 1)
  assert.equal(getBrokerStats().effectsWithoutGrant, 0)
})

/* ── D14-A: A_efectiva = A_tarea ∩ A_plugin ∩ A_delegación ∩ A_política ─ */

test('D14-A1 A_plugin: voice cannot net.fetch (not in pinned manifest)', () => {
  const d = authorize({
    channel: { kind: 'host.fetch', path: STATUS_PATH },
    task_id: null,
    effect: { kind: 'net.fetch', resource: 'https://evil.example', args_hash: 'x' },
    trust_in: 'user',
  })
  assertDenyQuartet(d, 'effect-not-in-grant')
  assert.equal(d.audit.a_plugin_ok, false)
})

test('D14-A2 A_tarea: grant without proc.spawn cannot spawn', () => {
  const g = issueTaskGrant({
    pluginId: 'abaco-voice',
    effects: ['host.fetch'],
    resources: [STATUS_PATH],
  })
  const d = authorize({
    channel: { kind: 'host.fetch', path: STATUS_PATH },
    task_id: g.task_id,
    grant_id: g.grant_id,
    effect: { kind: 'proc.spawn', resource: 'bin:mlx_whisper', args_hash: 'x' },
    trust_in: 'user',
  })
  assertDenyQuartet(d, 'effect-not-in-grant')
})

test('D14-A3 A_tarea: resource outside grant is denied', () => {
  const g = issueTaskGrant({
    pluginId: 'abaco-voice',
    effects: ['host.fetch'],
    resources: [STATUS_PATH],
  })
  const d = authorize({
    channel: { kind: 'host.fetch', path: STATUS_PATH },
    task_id: g.task_id,
    grant_id: g.grant_id,
    effect: { kind: 'host.fetch', resource: TRANSCRIBE_PATH, args_hash: 'x' },
    trust_in: 'user',
  })
  assertDenyQuartet(d, 'resource-not-in-grant')
})

test('D14-A4 A_delegación: forged grant_id is delegation-invalid', () => {
  // host.fetch + user auto-issues an ephemeral grant (voice route owner).
  // Delegation is tested on cordis.host so a claimed unknown grant_id cannot
  // be laundered into a new issuance.
  const d = authorize({
    channel: { kind: 'cordis.host', pluginId: 'abaco-voice' },
    task_id: randomUUID(),
    grant_id: 'forged-grant-id',
    effect: {
      kind: 'host.fetch',
      resource: STATUS_PATH,
      args_hash: hashArgs({ method: 'GET' }),
    },
    trust_in: 'user',
  })
  assertDenyQuartet(d, 'delegation-invalid')
})

test('D14-A5 A_política: untrusted cannot drive proc.spawn (data≠control)', () => {
  const d = authorize({
    channel: { kind: 'host.fetch', path: TRANSCRIBE_PATH },
    task_id: null,
    effect: { kind: 'proc.spawn', resource: 'bin:mlx_whisper', args_hash: 'x' },
    trust_in: 'untrusted',
  })
  assertDenyQuartet(d, 'data-as-control')
})

test('D14-A6 A_política: compose.mutate from plugin-data is forbidden', () => {
  const d = authorize({
    channel: { kind: 'host.fetch', path: TRANSCRIBE_PATH },
    task_id: null,
    effect: { kind: 'compose.mutate', resource: 'agent.cordis.yml', args_hash: 'x' },
    trust_in: 'plugin-data',
  })
  assertDenyQuartet(d, 'compose-mutate-forbidden')
})

test('D14-A7 budget-exceeded after grant call budget is spent', () => {
  const g = voiceGrant({ budget: { calls: 1, bytes: 25 * 1024 * 1024 } })
  const first = authorize({
    channel: { kind: 'host.fetch', path: STATUS_PATH },
    task_id: g.task_id,
    grant_id: g.grant_id,
    effect: {
      kind: 'host.fetch',
      resource: STATUS_PATH,
      args_hash: hashArgs({ method: 'GET' }),
    },
    trust_in: 'user',
  })
  assert.equal(first.decision, 'allow')
  const second = authorize({
    channel: { kind: 'host.fetch', path: STATUS_PATH },
    task_id: g.task_id,
    grant_id: g.grant_id,
    effect: {
      kind: 'host.fetch',
      resource: STATUS_PATH,
      args_hash: hashArgs({ method: 'GET' }),
    },
    trust_in: 'user',
  })
  assertDenyQuartet(second, 'budget-exceeded')
})

test('D14-A8 ttl-expired after grant ttl elapses', async () => {
  const g = voiceGrant({ ttlMs: 1 })
  await new Promise((r) => setTimeout(r, 20))
  const d = authorize({
    channel: { kind: 'host.fetch', path: STATUS_PATH },
    task_id: g.task_id,
    grant_id: g.grant_id,
    effect: {
      kind: 'host.fetch',
      resource: STATUS_PATH,
      args_hash: hashArgs({ method: 'GET' }),
    },
    trust_in: 'user',
  })
  assertDenyQuartet(d, 'ttl-expired')
})

/* ── D14-R: revocation deny ≤1s ───────────────────────────────────────── */

test('D14-R revokeGrant → next authorize deny in ≤1000ms (sync, piloto local)', () => {
  const g = voiceGrant()
  const happy = authorize({
    channel: { kind: 'host.fetch', path: STATUS_PATH },
    task_id: g.task_id,
    grant_id: g.grant_id,
    effect: {
      kind: 'host.fetch',
      resource: STATUS_PATH,
      args_hash: hashArgs({ method: 'GET' }),
    },
    trust_in: 'user',
  })
  assert.equal(happy.decision, 'allow')

  const t0 = Date.now()
  assert.equal(revokeGrant(g.grant_id), true)
  const d = authorize({
    channel: { kind: 'host.fetch', path: STATUS_PATH },
    task_id: g.task_id,
    grant_id: g.grant_id,
    effect: {
      kind: 'host.fetch',
      resource: STATUS_PATH,
      args_hash: hashArgs({ method: 'GET' }),
    },
    trust_in: 'user',
  })
  const elapsed = Date.now() - t0
  assertDenyQuartet(d, 'grant-revoked')
  assert.equal(inspectGrant(g.grant_id).live, false)
  assert.ok(elapsed <= 1000, `revoke→deny took ${elapsed}ms, contract is ≤1000ms`)
})

/* ── D14-C: candados Atena / Janice / no rehab ────────────────────────── */

test('D14-C Atena is not a grantor; Janice = runtime; authorize body has no Atena', async () => {
  assert.equal(ADMISSION_ROLES.janice, 'runtime')
  assert.equal(ADMISSION_ROLES.atena, 'advisor-never-grants')
  const broker = await readFile(join(PKG_DIR, 'index.js'), 'utf8')
  const authorizeFn = broker.slice(broker.indexOf('export function authorize'))
  assert.doesNotMatch(authorizeFn, /\bAtena\b/)
  assert.doesNotMatch(authorizeFn, /\batenaAdvise\b/)
  assert.match(broker, /Janice = runtime/)
})

test('D14-C disabled plugins stay disabled (no rehab)', () => {
  for (const id of [
    'abaco-brand',
    'abaco-device-identity',
    'abaco-cloud-sync',
    'abaco-onboarding',
    'abaco-experimental',
  ]) {
    assert.ok(DISABLED_PLUGINS.has(id), id)
    const d = authorize({
      channel: { kind: 'cordis.host', pluginId: id },
      task_id: null,
      effect: { kind: 'host.fetch', resource: '/x', args_hash: 'x' },
      trust_in: 'user',
    })
    assertDenyQuartet(d, 'plugin-disabled')
  }
})

test('D14-C forged body plugin_id is ignored — identity is channel path', () => {
  const id = resolveIdentity({
    kind: 'host.fetch',
    path: TRANSCRIBE_PATH,
    pluginId: 'abaco-brand',
  })
  assert.equal(id, 'abaco-voice')
})

/* ── D14-S: never touch ~/Library/Application Support/dsh-desktop/ ────── */

test('D14-S broker audit never writes under Application Support/dsh-desktop', async () => {
  const src = await readFile(join(PKG_DIR, 'index.js'), 'utf8')
  assert.match(src, /never dsh-desktop/)
  assert.match(src, /abaco-deep-core-audit-f1/)
  assert.doesNotMatch(src, /Application Support\/dsh-desktop/)

  const root = join(tmpdir(), `f1-day14-stayout-${process.pid}-${Date.now()}`)
  const dshDesktop = join(root, 'Library', 'Application Support', 'dsh-desktop')
  const home = join(root, 'home')
  await mkdir(dshDesktop, { recursive: true })
  await mkdir(home, { recursive: true })

  const prevHome = process.env.HOME
  const prevDsh = process.env.DSH_HOME
  process.env.HOME = home
  process.env.DSH_HOME = home
  try {
    const d = authorize(voiceStatusReq())
    assert.equal(d.decision, 'allow')
    await new Promise((r) => setTimeout(r, 80))
  } finally {
    if (prevHome === undefined) delete process.env.HOME
    else process.env.HOME = prevHome
    if (prevDsh === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prevDsh
  }

  const decoy = await readdir(dshDesktop)
  assert.deepEqual(decoy, [], 'dsh-desktop decoy must stay empty')
  if (existsSync(join(home, 'abaco-deep-core-audit-f1'))) {
    const st = await stat(join(home, 'abaco-deep-core-audit-f1'))
    assert.ok(st.isDirectory())
  }
})

test('D14-S F1 package sources do not target the DeepSeek dsh-desktop profile', async () => {
  const files = [
    join(PKG_DIR, 'index.js'),
    join(PKG_DIR, 'admission.js'),
    join(DESK, 'packages/abaco-mediacion-pilot/index.js'),
    join(DESK, 'packages/abaco-mediacion-pilot/worker.js'),
    join(DESK, 'packages/abaco-voice/index.js'),
  ]
  for (const file of files) {
    const src = await readFile(file, 'utf8')
    assert.doesNotMatch(
      src,
      /Application Support\/dsh-desktop/,
      file,
    )
  }
})

/* ── D14-P: Python core/voice is not the same F1 effect ───────────────── */

/* ── D14-E: admitted plugins still evolve / ship (doctrine delta) ─────── */

test('D14-E1 deny of unauthorized effect does not freeze admitted voice', () => {
  const blocked = authorize({
    channel: { kind: 'cordis.host', pluginId: 'abaco-brand' },
    task_id: null,
    effect: { kind: 'host.fetch', resource: '/x', args_hash: 'x' },
    trust_in: 'user',
  })
  assertDenyQuartet(blocked, 'plugin-disabled')

  const happy = authorize(voiceStatusReq())
  assert.equal(happy.decision, 'allow')
  assert.equal(happy.grant.plugin_id, 'abaco-voice')
  assert.ok(happy.grant.grant_id)
})

test('D14-E2 after revoke, a new grant on the same admitted plugin still allows', () => {
  const old = voiceGrant()
  assert.equal(revokeGrant(old.grant_id), true)
  const fresh = voiceGrant()
  assert.notEqual(fresh.grant_id, old.grant_id)
  const d = authorize({
    channel: { kind: 'host.fetch', path: STATUS_PATH },
    task_id: fresh.task_id,
    grant_id: fresh.grant_id,
    effect: {
      kind: 'host.fetch',
      resource: STATUS_PATH,
      args_hash: hashArgs({ method: 'GET' }),
    },
    trust_in: 'user',
  })
  assert.equal(d.decision, 'allow')
  assert.equal(inspectGrant(old.grant_id).live, false)
  assert.equal(inspectGrant(fresh.grant_id).live, true)
})

test('D14-E3 pin rotation is review-time (sign-manifest), not a runtime lockout API', async () => {
  const broker = await readFile(join(PKG_DIR, 'index.js'), 'utf8')
  assert.match(broker, /PINNED_MANIFEST_DIGEST/)
  assert.match(broker, /sign-manifest\.mjs/)
  const signer = await readFile(join(REPO, 'scripts/sign-manifest.mjs'), 'utf8')
  assert.match(signer, /ROTATION PROCEDURE/)
  assert.match(signer, /code review/)
  assert.doesNotMatch(broker, /export function rotatePin/)
  assert.doesNotMatch(broker, /export function rotateManifest/)
})

test('D14-P Python core/voice is not the F1 authorize path (no silent side-channel)', async () => {
  const voiceDir = join(REPO, 'core/voice')
  const names = (await readdir(voiceDir)).filter((n) => n.endsWith('.py'))
  assert.ok(names.length > 0, 'core/voice python modules exist')
  for (const name of names) {
    const src = await readFile(join(voiceDir, name), 'utf8')
    assert.doesNotMatch(src, /abaco-effect-broker/)
    assert.doesNotMatch(src, /issueTaskGrant/)
    assert.doesNotMatch(src, /authorize\s*\(/)
  }
})
