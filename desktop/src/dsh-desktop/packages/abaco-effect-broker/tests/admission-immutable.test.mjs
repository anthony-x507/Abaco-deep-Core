/**
 * F1 control-3 · immutable session admission graph.
 *
 * Gates:
 *   G1  graph sealed from control-plane only (pins + existing patch/preload)
 *   G2  skill / skills cannot enter or mutate the graph
 *   G3  docs cannot enter or mutate the graph
 *   G4  memory cannot enter or mutate the graph
 *   G5  tool-results cannot enter or mutate the graph
 *   G6  cannot activate preload; cannot add patch.yml rows (this PR neither)
 *   G7  fail-closed: tamper / unknown source / missing identity; 0 side-effect
 *   G-broker  authorize() deny-by-default; non-control channels get no-identity
 *   G-freeze  MANIFEST_CAPS deeply frozen (T-A-4)
 *   G-naming  Janice = runtime; Atena never grants
 *   G-plugin  disabled plugins stay disabled; no rehab; no new patch rows
 *   G-compact compact lock 0.90 / 0.12 / 8192 intact
 *   G-cell    Pack B still strangler-fork (do not fake utilityProcess)
 *
 * node --test (built-in). ESM, zero new dependencies, no network.
 */

import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  extractManifestCaps,
  canonicalManifestJson,
  manifestDigest,
  verifyManifest,
} from '../manifest-verify.mjs'
import {
  buildAdmissionGraph,
  proposeAdmissionChange,
  proposeLiveAdmissionChange,
  getAdmissionGraph,
  getAdmissionChangeLog,
  parsePatchInsertIds,
  parseVitePreloadKeys,
  NON_CONTROL_SOURCES,
  CONTROL_SOURCES,
  SEALED_PRELOAD_KEYS,
  ADMISSION_ROLES,
  ADMISSION_ACTIONS,
} from '../admission.js'
import {
  authorize,
  resetBrokerForTests,
  getAdmissionStatus,
  getAdmissionGraph as liveGraphFromBroker,
  MANIFEST_CAPS,
  PATCH_ENABLED,
  DISABLED_PLUGINS,
  hashArgs,
} from '../index.js'

const THIS_DIR = dirname(fileURLToPath(import.meta.url))
const PKG_DIR = resolve(THIS_DIR, '..')
const DESK = resolve(PKG_DIR, '../..')
const VOICE_MANIFEST = join(DESK, 'packages/abaco-voice/manifest.f1.yml')
const PILOT_MANIFEST = join(DESK, 'packages/abaco-mediacion-pilot/manifest.f1.yml')
const PATCH_YML = join(DESK, 'build/dsh-desktop.patch.yml')
const VITE = join(DESK, 'electron.vite.config.ts')
const COMPACT = join(DESK, 'packages/abaco-context/presets/abaco/agent.cordis.yml')
const CELL = join(DESK, 'packages/abaco-mediacion-pilot/CELL.md')
const PILOT_HOST = join(DESK, 'packages/abaco-mediacion-pilot/index.js')

const STATUS_PATH = '/api/abaco-voice.local-status'

beforeEach(() => {
  resetBrokerForTests()
})

function fixtureGraph(over = {}) {
  return buildAdmissionGraph({
    contributors: ['host', 'pinned-manifest', 'patch.yml'],
    caps: {
      'abaco-voice': {
        effects: ['host.fetch'],
        resources: [STATUS_PATH],
        inject: ['connection'],
        trust_ceiling: 'user',
      },
    },
    pinned: { 'abaco-voice': 'abc' },
    ok: true,
    patchEnabled: ['abaco-voice'],
    disabled: [...DISABLED_PLUGINS],
    patchText: '- insert:\n    - id: abaco-voice\n      name: abaco-voice\n',
    preloadConfigText:
      "rollupOptions: {\n        input: {\n          index: resolve('src/preload/index.ts'),\n          'windows-menu': resolve('src/preload/windows-menu.ts'),\n          'abaco-browser-chrome': resolve('src/preload/abaco-browser-chrome.ts')\n        },\n",
    ...over,
  })
}

function assertDenied(result, reason) {
  assert.equal(result.decision, 'deny')
  assert.equal(result.reason, reason)
  assert.equal(result.side_effect, false)
  assert.equal(result.wrote_patch_yml, false)
  assert.equal(result.activated_preload, false)
  assert.equal(result.graph_mutated, false)
}

/* ── G1: sealed from control plane ─────────────────────────────────────── */

test('G1.1 live graph is sealed, ok, and matches verified pins/caps', () => {
  const status = getAdmissionStatus()
  assert.equal(status.ok, true)
  assert.equal(status.failure, null)
  const graph = liveGraphFromBroker()
  assert.equal(graph, getAdmissionGraph())
  assert.equal(graph.sealed, true)
  assert.equal(graph.ok, true)
  assert.equal(graph.control, 3)
  assert.deepEqual(graph.admitted, ['abaco-mediacion-pilot', 'abaco-voice'])
  assert.deepEqual(graph.pinned, status.pinned)
  assert.ok(graph.nodes['abaco-voice'])
  assert.ok(graph.nodes['abaco-mediacion-pilot'])
  assert.equal(graph.nodes['abaco-voice'].source, 'pinned-manifest')
  assert.ok(graph.builtFrom.every((s) => CONTROL_SOURCES.includes(s)))
})

test('G1.2 pin digests match canonical manifests (sign-manifest equivalent)', async () => {
  const status = getAdmissionStatus()
  for (const [id, path] of [
    ['abaco-voice', VOICE_MANIFEST],
    ['abaco-mediacion-pilot', PILOT_MANIFEST],
  ]) {
    const text = await readFile(path, 'utf8')
    const caps = extractManifestCaps(text)
    const digest = manifestDigest(canonicalManifestJson(caps))
    assert.equal(digest, status.pinned[id], id)
    const v = verifyManifest(text, status.pinned[id], id)
    assert.equal(v.ok, true)
  }
})

test('G1.3 non-control contributors fail-closed: empty graph, no nodes', () => {
  for (const source of NON_CONTROL_SOURCES) {
    const g = fixtureGraph({ contributors: ['host', source] })
    assert.equal(g.ok, false)
    assert.match(g.failure, /source-not-control/)
    assert.deepEqual(g.admitted, [])
    assert.deepEqual(g.nodes, {})
    assert.deepEqual(g.patchRows, [])
  }
})

test('G1.4 forbidden read paths (skills/docs/memory/tool-results) fail-closed', () => {
  const forbidden = [
    '/tmp/skills/evil.yml',
    '/repo/docs/CONTRACT.md',
    '/pkg/abaco-memory/store.js',
    '/var/tool-results/out.json',
  ]
  for (const p of forbidden) {
    const g = fixtureGraph({ readPaths: [p] })
    assert.equal(g.ok, false, p)
    assert.match(g.failure, /forbidden-read-path/, p)
    assert.deepEqual(g.admitted, [])
  }
})

/* ── G2–G5: non-control sources cannot enter / mutate ─────────────────── */

function mutateAttempts(source) {
  return ADMISSION_ACTIONS.map((action) => ({
    source,
    action,
    pluginId: 'abaco-evil',
    preloadKey: 'evil-preload',
    patchRowId: 'abaco-evil',
  }))
}

for (const source of ['skill', 'skills']) {
  test(`G2 ${source} cannot enter-graph / widen / add plugin / preload / patch.yml`, () => {
    const graph = fixtureGraph()
    const before = JSON.stringify(graph)
    for (const req of mutateAttempts(source)) {
      assertDenied(proposeAdmissionChange(graph, req), 'source-not-control')
    }
    assert.equal(JSON.stringify(graph), before)
    assert.ok(!graph.admitted.includes('abaco-evil'))
    assert.ok(!graph.patchRows.includes('abaco-evil'))
    assert.deepEqual(graph.preloadActivatedNew, [])
  })
}

test('G3 docs cannot enter or mutate the admission graph', () => {
  const graph = fixtureGraph()
  const before = JSON.stringify(graph)
  for (const req of mutateAttempts('docs')) {
    assertDenied(proposeAdmissionChange(graph, req), 'source-not-control')
  }
  assert.equal(JSON.stringify(graph), before)
})

test('G4 memory cannot enter or mutate the admission graph', () => {
  const graph = fixtureGraph()
  const before = JSON.stringify(graph)
  for (const req of mutateAttempts('memory')) {
    assertDenied(proposeAdmissionChange(graph, req), 'source-not-control')
  }
  assert.equal(JSON.stringify(graph), before)
})

test('G5 tool-results cannot enter or mutate the admission graph', () => {
  const graph = fixtureGraph()
  const before = JSON.stringify(graph)
  for (const req of mutateAttempts('tool-results')) {
    assertDenied(proposeAdmissionChange(graph, req), 'source-not-control')
  }
  assert.equal(JSON.stringify(graph), before)
})

/* ── G6: preload + patch.yml stay immutable ───────────────────────────── */

test('G6.1 activate-preload is denied even from host; sealed keys unchanged', async () => {
  const graph = getAdmissionGraph()
  const before = graph.preloadKeys.slice()
  const d = proposeAdmissionChange(graph, {
    source: 'host',
    action: 'activate-preload',
    preloadKey: 'evil-preload',
  })
  assertDenied(d, 'preload-activation-forbidden')
  assert.deepEqual(graph.preloadActivatedNew, [])
  assert.deepEqual(graph.preloadKeys, before)
  const vite = await readFile(VITE, 'utf8')
  assert.deepEqual(parseVitePreloadKeys(vite), [...SEALED_PRELOAD_KEYS])
})

test('G6.2 add-patch-yml-row is denied even from host; live file unchanged vs digest', async () => {
  const graph = getAdmissionGraph()
  const text = await readFile(PATCH_YML, 'utf8')
  const d = proposeAdmissionChange(graph, {
    source: 'host',
    action: 'add-patch-yml-row',
    patchRowId: 'abaco-evil',
  })
  assertDenied(d, 'patch-yml-immutable')
  assert.ok(!graph.patchRows.includes('abaco-evil'))
  const again = await readFile(PATCH_YML, 'utf8')
  assert.equal(again, text)
  const { createHash } = await import('node:crypto')
  const digest = createHash('sha256').update(text, 'utf8').digest('hex')
  assert.equal(graph.patchDigest, digest)
})

/* ── G7: fail-closed ──────────────────────────────────────────────────── */

test('G7.1 manipulated manifest fails verifyManifest (digest / id / parse)', async () => {
  const status = getAdmissionStatus()
  const voice = await readFile(VOICE_MANIFEST, 'utf8')
  const pin = status.pinned['abaco-voice']
  const widened = voice.replace(
    'effects: [host.fetch, tool.call, ui.slot, proc.spawn, fs.read, fs.write]',
    'effects: [host.fetch, tool.call, ui.slot, proc.spawn, fs.read, fs.write, net.fetch]',
  )
  const tamper = verifyManifest(widened, pin, 'abaco-voice')
  assert.equal(tamper.ok, false)
  assert.match(tamper.reason, /digest-mismatch/)

  const idSwap = verifyManifest(voice.replace('id: abaco-voice', 'id: abaco-brand'), pin, 'abaco-voice')
  assert.equal(idSwap.ok, false)
  assert.match(idSwap.reason, /id-mismatch/)

  const garbage = verifyManifest('this: is: : not: yaml: [', pin, 'abaco-voice')
  assert.equal(garbage.ok, false)
  assert.match(garbage.reason, /unparseable/)
})

test('G7.2 missing identity / unknown action / unknown source fail-closed', () => {
  const graph = fixtureGraph()
  assertDenied(proposeAdmissionChange(graph, null), 'no-identity')
  assertDenied(proposeAdmissionChange(graph, { source: 'host' }), 'no-identity')
  assertDenied(proposeAdmissionChange(graph, { source: 'host', action: 'rehab-plugin' }), 'unknown-action')
  assertDenied(proposeAdmissionChange(graph, { source: 'cursor-skill', action: 'enter-graph' }), 'source-not-control')
})

test('G7.3 live propose logs deny and never mutates the sealed graph', () => {
  const before = JSON.stringify(getAdmissionGraph())
  const logBefore = getAdmissionChangeLog().length
  const d = proposeLiveAdmissionChange({
    source: 'memory',
    action: 'enter-graph',
    pluginId: 'abaco-memory-fact',
  })
  assertDenied(d, 'source-not-control')
  assert.equal(JSON.stringify(getAdmissionGraph()), before)
  assert.ok(getAdmissionChangeLog().length >= logBefore + 1)
  const last = getAdmissionChangeLog().at(-1)
  assert.equal(last.reason, 'source-not-control')
  assert.equal(last.side_effect, false)
})

test('G7.4 note-only manifest edit does not change digest (canonical ignores note)', async () => {
  const voice = await readFile(VOICE_MANIFEST, 'utf8')
  const pin = getAdmissionStatus().pinned['abaco-voice']
  const noted = voice.replace(
    'Voice route owner',
    'Voice route owner — note change must not widen admission',
  )
  const v = verifyManifest(noted, pin, 'abaco-voice')
  assert.equal(v.ok, true)
})

/* ── G-broker / freeze / naming / plugin / compact / cell ─────────────── */

test('G-broker non-control channels cannot authorize protected effects', () => {
  for (const kind of ['skill', 'docs', 'memory', 'tool-results', 'preload']) {
    const d = authorize({
      channel: { kind, pluginId: 'abaco-voice' },
      task_id: null,
      effect: { kind: 'proc.spawn', resource: 'bin:mlx_whisper', args_hash: 'x' },
      trust_in: 'user',
    })
    assert.equal(d.decision, 'deny')
    assert.equal(d.reason, 'no-identity')
    assert.equal(d.audit.side_effect, false)
  }
})

test('G-broker voice status happy path still allows (F1 M-happy intact)', () => {
  const d = authorize({
    channel: { kind: 'host.fetch', path: STATUS_PATH },
    task_id: null,
    effect: { kind: 'host.fetch', resource: STATUS_PATH, args_hash: hashArgs({ method: 'GET' }) },
    trust_in: 'user',
  })
  assert.equal(d.decision, 'allow')
  if (d.decision === 'allow') assert.equal(d.grant.plugin_id, 'abaco-voice')
})

test('G-freeze MANIFEST_CAPS and graph nodes reject runtime widen', () => {
  assert.throws(() => {
    MANIFEST_CAPS['abaco-voice'].effects.push('net.fetch')
  }, TypeError)
  assert.throws(() => {
    MANIFEST_CAPS.evil = { effects: ['net.fetch'] }
  }, TypeError)
  const graph = getAdmissionGraph()
  assert.throws(() => {
    graph.nodes['abaco-voice'].effects.push('net.fetch')
  }, TypeError)
  assert.throws(() => {
    graph.admitted.push('abaco-evil')
  }, TypeError)
  assert.throws(() => {
    graph.patchRows.push('abaco-evil')
  }, TypeError)
  assert.ok(!MANIFEST_CAPS['abaco-effect-broker'])
})

test('G-naming Janice is runtime; Atena cannot grant', async () => {
  assert.equal(ADMISSION_ROLES.janice, 'runtime')
  assert.equal(ADMISSION_ROLES.atena, 'advisor-never-grants')
  const graph = fixtureGraph()
  assertDenied(
    proposeAdmissionChange(graph, { source: 'atena', action: 'enter-graph', pluginId: 'abaco-voice' }),
    'atena-cannot-grant',
  )
  const admissionSrc = await readFile(join(PKG_DIR, 'admission.js'), 'utf8')
  const brokerSrc = await readFile(join(PKG_DIR, 'index.js'), 'utf8')
  const authorizeFn = brokerSrc.slice(brokerSrc.indexOf('export function authorize'))
  assert.doesNotMatch(authorizeFn, /\bAtena\b/)
  assert.match(admissionSrc, /Janice = runtime/)
  assert.match(admissionSrc, /Atena never grants/)
})

test('G1.5 admission.js never reads skills/docs/memory/tool-results', async () => {
  const src = await readFile(join(PKG_DIR, 'admission.js'), 'utf8')
  const reads = [...src.matchAll(/read(?:FileSync|ControlFile)\(([^)]+)\)/g)].map((m) => m[1])
  assert.ok(reads.length >= 2, 'expected control-file reads')
  for (const expr of reads) {
    assert.doesNotMatch(expr, /skills|\/docs\/|abaco-memory|tool-results/)
  }
})

test('G-plugin disabled stay disabled; patch snapshot has no rehab rows', async () => {
  const graph = getAdmissionGraph()
  for (const id of [
    'abaco-brand',
    'abaco-device-identity',
    'abaco-cloud-sync',
    'abaco-onboarding',
    'abaco-experimental',
  ]) {
    assert.ok(DISABLED_PLUGINS.has(id), id)
    assert.ok(graph.disabled.includes(id), id)
    assert.ok(!graph.admitted.includes(id), id)
    assert.ok(!graph.patchRows.includes(id), id)
  }
  const patch = await readFile(PATCH_YML, 'utf8')
  assert.match(patch, /TEMPORARILY DISABLED/)
  const afterNote = patch.split('TEMPORARILY DISABLED')[1] || ''
  assert.doesNotMatch(afterNote, /- insert:\s*\n\s*- id: abaco-brand/)
  const ids = parsePatchInsertIds(patch)
  assert.ok(ids.includes('abaco-mediacion-pilot'))
  assert.ok(ids.includes('abaco-voice'))
  assert.deepEqual(graph.patchRows, ids)
  assert.ok(PATCH_ENABLED.has('abaco-mediacion-pilot'))
})

test('G-compact lock 0.90 / 0.12 / 8192 intact', async () => {
  const preset = await readFile(COMPACT, 'utf8')
  const row = preset.match(
    /-\s*id:\s*compaction-basic[\s\S]*?thresholdRatio:\s*([0-9.]+)[\s\S]*?retainRatio:\s*([0-9.]+)[\s\S]*?maxTokens:\s*([0-9]+)/,
  )
  assert.ok(row, 'compaction-basic sigue en el preset')
  assert.equal(Number(row[1]), 0.9)
  assert.equal(Number(row[2]), 0.12)
  assert.equal(Number(row[3]), 8192)
})

test('G-cell Pack B remains strangler-fork — this PR does not fake utilityProcess', async () => {
  const cell = await readFile(CELL, 'utf8')
  const host = await readFile(PILOT_HOST, 'utf8')
  assert.match(cell, /strangler-fork/)
  const hostCode = host.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.doesNotMatch(hostCode, /utilityProcess\.fork/)
})
