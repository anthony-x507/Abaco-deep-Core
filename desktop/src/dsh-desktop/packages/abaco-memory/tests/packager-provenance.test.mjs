/**
 * F1.5 · 3-phase memory packager provenance (fail-closed).
 *
 * Gates:
 *   G1  phases frozen; scope/facet routing is total
 *   G2  effective = min(claim, channel); hash stable across key order
 *   G3  Pack A quarantine not weakened (untrusted/plugin-data stay quarantined)
 *   G4  masquerade cannot admit into profile
 *   G5  note/log cannot escalate to profile without host|user attestor
 *   G6  memory cannot enter control / preload / patch.yml
 *   G7  Atena never grants; Janice = runtime
 *   G8  store.package is additive; set/promote unchanged; deny audited
 *   G9  compact lock 0.90/0.12/8192; disabled plugins intact; no MCP pin files
 *
 * node --test (built-in). ESM, zero new dependencies, no network.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MemoryStore } from '../lib/store.js'
import { MemorySchemaError } from '../lib/schema.js'
import { initialStateFor, reviewerCanPromote, trustOf } from '../lib/quarantine.js'
import {
  FACET_PHASE,
  MEMORY_PHASES,
  PACKAGER_ROLES,
  PACKAGER_TRUST_ORDINAL,
  PHASE_OF_SCOPE,
  PHASE_RANK,
  advancePhase,
  attestorCanGrant,
  channelFromSource,
  effectiveTier,
  packageMemory,
  phaseOf,
  proposeControl,
  toPackATrust,
  verifyPackage
} from '../lib/packager.js'

const THIS_DIR = dirname(fileURLToPath(import.meta.url))
const PKG_DIR = resolve(THIS_DIR, '..')
const DESK = resolve(PKG_DIR, '../..')
const REPO = resolve(DESK, '../../..')
const COMPACT = join(DESK, 'packages/abaco-context/presets/abaco/agent.cordis.yml')
const PATCH_YML = join(DESK, 'build/dsh-desktop.patch.yml')

async function freshStore() {
  const root = await mkdtemp(join(tmpdir(), 'abaco-mem-pkg-'))
  return new MemoryStore({ root })
}

async function journalLines(store) {
  let text = ''
  try {
    text = await readFile(store.auditPath, 'utf8')
  } catch {
    return []
  }
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line))
}

async function pathExists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

function assertDenied(result, reason) {
  assert.equal(result.decision, 'deny')
  assert.equal(result.reason, reason)
  assert.equal(result.side_effect, false)
  assert.equal(result.control, false)
  assert.equal(result.graph_mutated, false)
  assert.equal(result.wrote_patch_yml, false)
  assert.equal(result.activated_preload, false)
}

/* ── G1: three phases, frozen routing ───────────────────────────────────── */

test('G1.1 MEMORY_PHASES is exactly profile / log / note and frozen', () => {
  assert.deepEqual([...MEMORY_PHASES], ['profile', 'log', 'note'])
  assert.ok(Object.isFrozen(MEMORY_PHASES))
  assert.throws(() => {
    MEMORY_PHASES.push('control')
  }, TypeError)
})

test('G1.2 phaseOf maps scopes and facets; unknown is undefined (fail-closed)', () => {
  assert.equal(phaseOf('profile'), 'profile')
  assert.equal(phaseOf('role'), 'profile')
  assert.equal(phaseOf('project'), 'log')
  assert.equal(phaseOf('session'), 'note')
  assert.equal(phaseOf('preferences_user'), 'profile')
  assert.equal(phaseOf('facts'), 'log')
  assert.equal(phaseOf('tasks'), 'note')
  assert.equal(phaseOf('control'), undefined)
  assert.equal(phaseOf('admission'), undefined)
  assert.equal(phaseOf('bogus'), undefined)
  assert.deepEqual(PHASE_OF_SCOPE.session, 'note')
  assert.deepEqual(FACET_PHASE.decisions, 'log')
  assert.ok(Object.isFrozen(PHASE_OF_SCOPE))
  assert.ok(Object.isFrozen(FACET_PHASE))
  assert.equal(PHASE_RANK.note < PHASE_RANK.log, true)
  assert.equal(PHASE_RANK.log < PHASE_RANK.profile, true)
})

/* ── G2: provenance + integrity ─────────────────────────────────────────── */

test('G2.1 effective = min(claim, channel); host aliases system', () => {
  assert.equal(effectiveTier('user', 'plugin-data'), 'plugin-data')
  assert.equal(effectiveTier('system', 'plugin-data'), 'plugin-data')
  assert.equal(effectiveTier('user', 'system'), 'user')
  assert.equal(effectiveTier('host', 'user'), 'user')
  assert.equal(effectiveTier('bogus', 'user'), undefined)
  assert.equal(PACKAGER_TRUST_ORDINAL.system, 5)
  assert.equal(PACKAGER_TRUST_ORDINAL.host, 5)
  assert.equal(PACKAGER_TRUST_ORDINAL.untrusted, 0)
  assert.equal(channelFromSource('tool:webfetch'), 'untrusted')
  assert.equal(channelFromSource('plugin:x'), 'plugin-data')
  assert.equal(channelFromSource('agent:turn-1'), 'system')
  assert.equal(channelFromSource('user:turn-3'), 'user')
  assert.equal(toPackATrust('system'), 'host')
  assert.equal(toPackATrust('user'), 'user')
})

test('G2.2 sealed package hashes identity; key order does not matter; tamper fails verify', () => {
  const a = packageMemory({ content: 'prefers brief answers', source: 'user:turn-1', phase: 'profile' })
  const b = packageMemory({
    phase: 'profile',
    source: 'user:turn-1',
    content: 'prefers brief answers'
  })
  assert.equal(a.decision, 'allow')
  assert.equal(a.hash, b.hash)
  assert.equal(verifyPackage(a), true)
  const tampered = { ...a, provenance: { ...a.provenance, effective: 'system' } }
  assert.equal(verifyPackage(tampered), false)
  assert.equal(verifyPackage({ ...a, content: a.content + '!' }), false)
  assert.equal(verifyPackage({ ...a, hash: '0'.repeat(64) }), false)
})

/* ── G3: Pack A quarantine stays ────────────────────────────────────────── */

test('G3.1 untrusted / plugin-data package into profile as quarantined, never admitted', () => {
  const tool = packageMemory({ content: 'from the web', source: 'tool:webfetch', phase: 'profile' })
  const plugin = packageMemory({ content: 'from a plugin', source: 'plugin:sk', phase: 'profile' })
  assert.equal(tool.decision, 'allow')
  assert.equal(tool.trust, 'untrusted')
  assert.equal(tool.state, 'quarantined')
  assert.equal(plugin.trust, 'plugin-data')
  assert.equal(plugin.state, 'quarantined')
  assert.equal(initialStateFor('untrusted'), 'quarantined')
  assert.equal(initialStateFor('plugin-data'), 'quarantined')
  assert.equal(tool.state, initialStateFor(trustOf('tool:webfetch')))
})

test('G3.2 user and agent still admit on the happy path (Pack A Q2 intact)', () => {
  const user = packageMemory({ content: 'dato user', source: 'user', phase: 'profile' })
  const agent = packageMemory({ content: 'dato agent', source: 'agent:turn-1', phase: 'profile' })
  assert.equal(user.trust, 'user')
  assert.equal(user.state, 'admitted')
  assert.equal(agent.trust, 'host')
  assert.equal(agent.state, 'admitted')
  assert.equal(reviewerCanPromote({ id: 'u', trust: 'user' }), true)
  assert.equal(reviewerCanPromote({ id: 'p', trust: 'plugin-data' }), false)
})

test('G3.3 admit:true on untrusted is denied; quarantine path still exists without admit', () => {
  const denied = packageMemory({
    content: 'smuggled',
    source: 'tool:read',
    phase: 'profile',
    admit: true,
    attestor: { id: 'host-1', trust: 'host' }
  })
  assertDenied(denied, 'provenance-policy')
  const held = packageMemory({ content: 'smuggled', source: 'tool:read', phase: 'profile' })
  assert.equal(held.decision, 'allow')
  assert.equal(held.state, 'quarantined')
})

/* ── G4: masquerade ─────────────────────────────────────────────────────── */

test('G4.1 claim user on plugin-data channel cannot admit; package stays masquerade-flagged', () => {
  const sealed = packageMemory({
    content: 'attacker note',
    claim: 'user',
    channel: 'plugin-data',
    phase: 'profile'
  })
  assert.equal(sealed.decision, 'allow')
  assert.equal(sealed.provenance.effective, 'plugin-data')
  assert.equal(sealed.masquerade, true)
  assert.equal(sealed.state, 'quarantined')
  const admit = packageMemory({
    content: 'attacker note',
    claim: 'user',
    channel: 'plugin-data',
    phase: 'profile',
    admit: true,
    attestor: { id: 'host-1', trust: 'host' }
  })
  assertDenied(admit, 'phase-masquerade')
})

test('G4.2 caller trust that outranks effective is denied', () => {
  const d = packageMemory({
    content: 'dato',
    source: 'tool:read',
    phase: 'profile',
    trust: 'user'
  })
  assertDenied(d, 'phase-masquerade')
})

test('G4.3 facet/phase mismatch is denied (tasks cannot be labeled profile)', () => {
  const d = packageMemory({
    content: 'a task',
    source: 'user',
    phase: 'profile',
    facet: 'tasks'
  })
  assertDenied(d, 'phase-mismatch')
})

/* ── G5: phase escalation ───────────────────────────────────────────────── */

test('G5.1 note → profile without host/user attestor is phase-escalation', () => {
  const note = packageMemory({ content: 'working note', source: 'user', phase: 'note' })
  assert.equal(note.decision, 'allow')
  const naked = advancePhase(note, { toPhase: 'profile' })
  assertDenied(naked, 'phase-escalation')
  const plugin = advancePhase(note, { toPhase: 'profile', attestor: { id: 'p', trust: 'plugin-data' } })
  assertDenied(plugin, 'phase-escalation')
})

test('G5.2 note → profile with host attestor is allowed; demotion needs no grant', () => {
  const note = packageMemory({ content: 'working note', source: 'user', phase: 'note' })
  const up = advancePhase(note, { toPhase: 'profile', attestor: { id: 'host-1', trust: 'host' } })
  assert.equal(up.decision, 'allow')
  assert.equal(up.phase, 'profile')
  assert.equal(verifyPackage(up), true)
  const down = advancePhase(up, { toPhase: 'note' })
  assert.equal(down.decision, 'allow')
  assert.equal(down.phase, 'note')
})

test('G5.3 tampered package cannot advance (integrity)', () => {
  const note = packageMemory({ content: 'n', source: 'user', phase: 'note' })
  const d = advancePhase({ ...note, phase: 'log' }, { toPhase: 'profile', attestor: { id: 'h', trust: 'host' } })
  assertDenied(d, 'integrity')
})

/* ── G6: cannot become control ──────────────────────────────────────────── */

test('G6.1 proposeControl is always deny, zero side-effect', () => {
  const pkg = packageMemory({ content: 'pref', source: 'user', phase: 'profile' })
  for (const action of ['enter-graph', 'add-plugin', 'widen-caps', 'activate-preload', 'add-patch-yml-row']) {
    assertDenied(proposeControl(pkg, action), 'memory-cannot-enter-control')
  }
})

test('G6.2 target control / admission / preload / patch.yml is denied at package time', () => {
  for (const target of ['control', 'admission', 'preload', 'patch.yml']) {
    assertDenied(
      packageMemory({ content: 'x', source: 'user', phase: 'profile', target }),
      'memory-cannot-enter-control'
    )
  }
  const note = packageMemory({ content: 'n', source: 'user', phase: 'note' })
  assertDenied(advancePhase(note, { toPhase: 'control' }), 'memory-cannot-enter-control')
})

/* ── G7: Atena / Janice naming ──────────────────────────────────────────── */

test('G7.1 roles: Janice is runtime; Atena cannot grant', () => {
  assert.equal(PACKAGER_ROLES.janice, 'runtime')
  assert.equal(PACKAGER_ROLES.atena, 'advisor-never-grants')
  assert.equal(attestorCanGrant('atena'), false)
  assert.equal(attestorCanGrant('janice'), false)
  assert.equal(attestorCanGrant({ id: 'h', trust: 'host' }), true)
  assertDenied(
    packageMemory({
      content: 'x',
      source: 'user',
      phase: 'profile',
      admit: true,
      attestor: 'atena'
    }),
    'atena-cannot-grant'
  )
  assertDenied(
    packageMemory({
      content: 'x',
      source: 'user',
      phase: 'profile',
      admit: true,
      attestor: 'janice'
    }),
    'janice-is-runtime'
  )
})

test('G7.2 Atena / Janice cannot escalate a note to profile', () => {
  const note = packageMemory({ content: 'n', source: 'user', phase: 'note' })
  assertDenied(advancePhase(note, { toPhase: 'profile', attestor: 'atena' }), 'atena-cannot-grant')
  assertDenied(advancePhase(note, { toPhase: 'profile', attestor: 'janice' }), 'janice-is-runtime')
})

test('G7.3 packager source pins the naming contract; store.js still has no Janice decision', async () => {
  const packager = await readFile(join(PKG_DIR, 'lib', 'packager.js'), 'utf8')
  assert.match(packager, /Janice = runtime/)
  assert.match(packager, /Atena never grants/)
  const store = stripComments(await readFile(join(PKG_DIR, 'lib', 'store.js'), 'utf8'))
  assert.ok(!/\bJanice\b/i.test(store), 'store.js executable code still has no Janice')
  assert.ok(!/\bAtena\b/.test(store), 'store.js still has no Atena')
})

/* ── G8: store.package additive + audit ─────────────────────────────────── */

test('G8.1 store.package writes a user profile fact; Pack A set still works beside it', async () => {
  const store = await freshStore()
  const packaged = await store.package({
    path: 'preferences_user[+]',
    value: 'FRASE-PACKAGED-USER',
    source: 'user'
  })
  assert.equal(packaged.ok, true)
  assert.equal(packaged.trust, 'user')
  assert.equal(packaged.state, 'admitted')
  const direct = await store.set({
    path: 'preferences_user[+]',
    value: 'FRASE-SET-DIRECT',
    source: 'user'
  })
  assert.equal(direct.state, 'admitted')
  const got = await store.get({ path: 'preferences_user' })
  assert.equal(got.count, 2)
})

test('G8.2 store.package of tool data stays quarantined and invisible to get()', async () => {
  const store = await freshStore()
  const held = await store.package({
    path: 'preferences_user[+]',
    value: 'FRASE-PACKAGED-TOOL',
    source: 'tool:webfetch'
  })
  assert.equal(held.trust, 'untrusted')
  assert.equal(held.state, 'quarantined')
  const got = await store.get({ path: 'preferences_user' })
  assert.equal(got.count, 0)
})

test('G8.3 store.package deny is audited and writes nothing', async () => {
  const store = await freshStore()
  await assert.rejects(
    store.package({
      path: 'preferences_user[+]',
      value: 'x',
      source: 'tool:read',
      trust: 'user'
    }),
    (err) => {
      assert.ok(err instanceof MemorySchemaError)
      assert.equal(err.code, 'PHASE_MASQUERADE')
      return true
    }
  )
  assert.equal(await pathExists(store.pathFor('profile', '')), false)
  const lines = await journalLines(store)
  const deny = lines.find((line) => line.op === 'deny' && line.packager === true)
  assert.ok(deny, 'packager deny is journaled')
  assert.equal(deny.reason, 'phase-masquerade')
})

test('G8.4 store.package cannot target control', async () => {
  const store = await freshStore()
  await assert.rejects(
    store.package({
      path: 'preferences_user[+]',
      value: 'x',
      source: 'user',
      target: 'control'
    }),
    (err) => err.code === 'MEMORY_CANNOT_ENTER_CONTROL'
  )
})

test('G8.5 unknown phase / missing content fail-closed', () => {
  assertDenied(packageMemory({ content: 'x', source: 'user', phase: 'vault' }), 'phase-unknown')
  assertDenied(packageMemory({ source: 'user', phase: 'profile' }), 'no-identity')
  assertDenied(packageMemory({ content: 'x', phase: 'profile' }), 'no-identity')
})

/* ── G9: candados + plugin-safe + stay out of MCP pin ───────────────────── */

test('G9.1 compact lock 0.90 / 0.12 / 8192 intact', async () => {
  const preset = await readFile(COMPACT, 'utf8')
  const row = preset.match(
    /-\s*id:\s*compaction-basic[\s\S]*?thresholdRatio:\s*([0-9.]+)[\s\S]*?retainRatio:\s*([0-9.]+)[\s\S]*?maxTokens:\s*([0-9]+)/
  )
  assert.ok(row, 'compaction-basic sigue en el preset')
  assert.equal(Number(row[1]), 0.9)
  assert.equal(Number(row[2]), 0.12)
  assert.equal(Number(row[3]), 8192)
})

test('G9.2 disabled plugins stay disabled; no rehab insert after TEMPORARILY DISABLED', async () => {
  const patch = await readFile(PATCH_YML, 'utf8')
  assert.match(patch, /TEMPORARILY DISABLED/)
  const afterNote = patch.split('TEMPORARILY DISABLED')[1] || ''
  assert.doesNotMatch(afterNote, /- insert:\s*\n\s*- id: abaco-brand/)
  for (const id of [
    'abaco-brand',
    'abaco-device-identity',
    'abaco-cloud-sync',
    'abaco-onboarding',
    'abaco-experimental'
  ]) {
    assert.doesNotMatch(afterNote, new RegExp(`- id: ${id}`))
  }
})

test('G9.3 stay out of MCP pin wiring, patch.yml, and compact preset', () => {
  const out = execFileSync('git', ['-C', REPO, 'diff', '--name-only', 'origin/main'], { encoding: 'utf8' })
  const changed = out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  // 0.4.21 release may align the F1.5 version assert + contract G9 row.
  const versionAlign = new Set([
    'desktop/src/dsh-desktop/packages/abaco-mcp-schema-pin/tests/schema-pin.test.mjs',
    'docs/contracts/CONTRACT-F1.5-MCP-SCHEMA-PIN.md',
  ])
  for (const file of changed) {
    if (versionAlign.has(file)) continue
    assert.ok(!file.includes('abaco-mcp-schema-pin'), `MCP pin stay-out: ${file}`)
    assert.ok(!file.endsWith('run-f15-suite.mjs'), `MCP suite stay-out: ${file}`)
    assert.ok(!file.includes('CONTRACT-F1.5-MCP-SCHEMA-PIN'), `MCP contract stay-out: ${file}`)
    assert.ok(!file.includes('dsh-desktop.patch.yml'), `patch.yml stay-out: ${file}`)
    assert.ok(!file.includes('agent.cordis.yml'), `compact preset stay-out: ${file}`)
    assert.ok(!file.includes('abaco-mediacion-pilot'), `piloto stay-out (PR #16): ${file}`)
    assert.ok(!/Application Support\/dsh-desktop/.test(file), `dsh-desktop profile stay-out: ${file}`)
  }
})
