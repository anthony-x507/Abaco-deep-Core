/**
 * F1 control-3 — immutable session admission graph.
 *
 * The graph is sealed once from the host control plane:
 *   - pinned `manifest.f1.yml` (already verified by the broker TCB)
 *   - existing `build/dsh-desktop.patch.yml` insert rows (read-only snapshot)
 *   - existing Electron preload entry keys (read-only snapshot)
 *
 * Non-control sources MUST NOT enter the graph and cannot mutate it:
 *   skill | skills | docs | memory | tool-results
 *
 * Session rules (deny-by-default):
 *   - runtime mutation is always deny (even from `host`)
 *   - cannot activate preload
 *   - cannot add patch.yml rows
 *   - Atena never grants
 *   - Janice = runtime only
 *   - this module never writes preload, patch.yml, or a dsh-desktop profile
 *
 * Additive to F1 P3 (PINNED_MANIFEST_DIGEST / MANIFEST_CAPS). Does not replace
 * authorize(); authorize() remains the only path to protected sinks.
 *
 * @module abaco-effect-broker/admission
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Data / content sources that must never become admission control. */
export const NON_CONTROL_SOURCES = Object.freeze([
  'skill',
  'skills',
  'docs',
  'memory',
  'tool-results',
])

/** Only these may contribute nodes when the graph is built. */
export const CONTROL_SOURCES = Object.freeze(['host', 'pinned-manifest', 'patch.yml'])

/** Closed set of mutation verbs. Every one is denied at runtime. */
export const ADMISSION_ACTIONS = Object.freeze([
  'enter-graph',
  'add-plugin',
  'widen-caps',
  'activate-preload',
  'add-patch-yml-row',
  'mutate-graph',
])

/** Existing TCB preload entries. No new key may be activated this session. */
export const SEALED_PRELOAD_KEYS = Object.freeze([
  'index',
  'windows-menu',
  'abaco-browser-chrome',
])

/** Host session roles. Atena is advisory and is never a grantor. */
export const ADMISSION_ROLES = Object.freeze({
  janice: 'runtime',
  atena: 'advisor-never-grants',
})

/** Path fragments that must never be read while building the graph. */
export const FORBIDDEN_GRAPH_READ_FRAGMENTS = Object.freeze([
  '/skills/',
  '/docs/',
  '/abaco-memory/',
  'tool-results',
])

const NON_CONTROL = new Set(NON_CONTROL_SOURCES)
const CONTROL = new Set(CONTROL_SOURCES)
const ACTIONS = new Set(ADMISSION_ACTIONS)

/** @type {object | null} */
let liveGraph = null
/** @type {object[]} */
const changeLog = []

function sha256(s) {
  return createHash('sha256').update(String(s), 'utf8').digest('hex')
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item)
    return Object.freeze(value)
  }
  for (const key of Object.keys(value)) deepFreeze(value[key])
  return Object.freeze(value)
}

function snapshotCaps(caps) {
  const out = {}
  for (const [id, c] of Object.entries(caps || {})) {
    if (!c || typeof c !== 'object') continue
    out[id] = {
      effects: Object.freeze([...(c.effects || [])]),
      resources: Object.freeze([...(c.resources || [])]),
      inject: Object.freeze([...(c.inject || [])]),
      trust_ceiling: c.trust_ceiling || '',
      source: 'pinned-manifest',
    }
  }
  return out
}

/**
 * Insert ids of the form `- id: abaco-…` (plugin rows). Comments and
 * non-abaco rows (e.g. spill-policy) are ignored.
 * @param {string} text
 * @returns {string[]}
 */
export function parsePatchInsertIds(text) {
  const ids = []
  const seen = new Set()
  for (const raw of String(text || '').split('\n')) {
    const m = raw.match(/^\s+- id: (abaco-[a-z0-9-]+)\s*$/)
    if (!m) continue
    if (seen.has(m[1])) continue
    seen.add(m[1])
    ids.push(m[1])
  }
  return ids
}

/**
 * Preload rollup input keys from electron.vite.config.ts.
 * @param {string} text
 * @returns {string[]}
 */
export function parseVitePreloadKeys(text) {
  const block = String(text || '').match(/rollupOptions:\s*\{[\s\S]*?input:\s*\{([\s\S]*?)\}/)
  if (!block) return []
  const keys = []
  for (const m of block[1].matchAll(/^\s*(?:'([^']+)'|([A-Za-z0-9_-]+))\s*:/gm)) {
    keys.push(m[1] || m[2])
  }
  return keys
}

function deny(reason, extra = {}) {
  return Object.freeze({
    decision: 'deny',
    reason,
    side_effect: false,
    wrote_patch_yml: false,
    activated_preload: false,
    graph_mutated: false,
    ...extra,
  })
}

/**
 * Build a sealed admission graph. Fail-closed: any non-control contributor
 * or forbidden read path yields an empty graph with a failure reason.
 *
 * @param {object} input
 * @returns {object}
 */
export function buildAdmissionGraph(input) {
  const src = input && typeof input === 'object' ? input : {}
  const contributors = Array.isArray(src.contributors) ? src.contributors.map(String) : []
  const readPaths = Array.isArray(src.readPaths) ? src.readPaths.map(String) : []

  let failure = typeof src.failure === 'string' && src.failure ? src.failure : null
  if (!failure && src.ok === false) failure = 'admission-not-ok'

  for (const c of contributors) {
    if (NON_CONTROL.has(c) || !CONTROL.has(c)) {
      failure = `source-not-control: ${c}`
      break
    }
  }
  for (const p of readPaths) {
    const norm = p.replace(/\\/g, '/')
    if (FORBIDDEN_GRAPH_READ_FRAGMENTS.some((frag) => norm.includes(frag))) {
      failure = `forbidden-read-path: ${p}`
      break
    }
  }

  const empty = Boolean(failure)
  const nodes = empty ? {} : snapshotCaps(src.caps)
  const patchIds = empty ? [] : parsePatchInsertIds(src.patchText || '')
  const preloadFromFile = empty ? [] : parseVitePreloadKeys(src.preloadConfigText || '')
  const preloadKeys = empty
    ? []
    : [...new Set([...(preloadFromFile.length ? preloadFromFile : SEALED_PRELOAD_KEYS)])]

  const graph = {
    sealed: true,
    ok: !failure && src.ok !== false,
    failure,
    control: 3,
    roles: { ...ADMISSION_ROLES },
    contributors: Object.freeze([...contributors]),
    nodes: deepFreeze(nodes),
    admitted: Object.freeze(Object.keys(nodes).sort()),
    pinned: Object.freeze({ ...(empty ? {} : src.pinned || {}) }),
    patchEnabled: Object.freeze(
      empty ? [] : [...(src.patchEnabled || [])].map(String).sort(),
    ),
    disabled: Object.freeze(empty ? [] : [...(src.disabled || [])].map(String).sort()),
    patchRows: Object.freeze(patchIds),
    patchDigest: empty ? null : sha256(src.patchText || ''),
    preloadKeys: Object.freeze(preloadKeys),
    preloadActivatedNew: Object.freeze([]),
    builtFrom: Object.freeze(['pinned-manifest', 'patch.yml', 'host']),
  }
  return deepFreeze(graph)
}

/**
 * Propose a runtime change to a sealed graph. Always deny. Never writes.
 * @param {object} graph
 * @param {object} req
 */
export function proposeAdmissionChange(graph, req) {
  if (!graph || graph.sealed !== true) {
    return deny('session-immutable', { source: null, action: null })
  }
  if (!req || typeof req !== 'object') {
    return deny('no-identity')
  }
  const source = typeof req.source === 'string' ? req.source : ''
  const action = typeof req.action === 'string' ? req.action : ''
  if (!source || !action) {
    return deny('no-identity', { source: source || null, action: action || null })
  }
  if (source === 'atena') {
    return deny('atena-cannot-grant', { source, action })
  }
  if (NON_CONTROL.has(source) || !CONTROL.has(source)) {
    return deny('source-not-control', { source, action })
  }
  if (!ACTIONS.has(action)) {
    return deny('unknown-action', { source, action })
  }
  if (action === 'activate-preload') {
    return deny('preload-activation-forbidden', { source, action, preloadKey: req.preloadKey || null })
  }
  if (action === 'add-patch-yml-row') {
    return deny('patch-yml-immutable', { source, action, patchRowId: req.patchRowId || null })
  }
  // host / pinned-manifest / patch.yml at runtime: session is already sealed.
  return deny('session-immutable', { source, action, pluginId: req.pluginId || null })
}

function readControlFile(absPath) {
  const norm = String(absPath).replace(/\\/g, '/')
  if (FORBIDDEN_GRAPH_READ_FRAGMENTS.some((frag) => norm.includes(frag))) {
    throw new Error(`admission: refused forbidden read path ${absPath}`)
  }
  return readFileSync(absPath, 'utf8')
}

/**
 * Seal the process-wide session graph from verified broker state + on-disk
 * control snapshots. Safe to call once at broker import. Re-seal is refused
 * unless {@link resetAdmissionForTests} ran first.
 * @param {object} opts
 */
export function sealLiveAdmission(opts) {
  if (liveGraph && liveGraph.sealed) {
    return liveGraph
  }
  const pkgDir = dirname(fileURLToPath(import.meta.url))
  const desk = join(pkgDir, '..', '..')
  let patchText = ''
  let preloadConfigText = ''
  let readFailure = null
  try {
    patchText = readControlFile(join(desk, 'build/dsh-desktop.patch.yml'))
  } catch (e) {
    readFailure = `patch-yml-unreadable: ${e.message}`
  }
  try {
    preloadConfigText = readControlFile(join(desk, 'electron.vite.config.ts'))
  } catch (e) {
    if (!readFailure) readFailure = `preload-config-unreadable: ${e.message}`
  }
  liveGraph = buildAdmissionGraph({
    contributors: ['host', 'pinned-manifest', 'patch.yml'],
    readPaths: [
      join(desk, 'build/dsh-desktop.patch.yml'),
      join(desk, 'electron.vite.config.ts'),
    ],
    caps: opts?.caps,
    pinned: opts?.pinned,
    ok: readFailure ? false : opts?.ok !== false,
    failure: readFailure || opts?.failure || null,
    patchEnabled: opts?.patchEnabled,
    disabled: opts?.disabled,
    patchText,
    preloadConfigText,
  })
  changeLog.length = 0
  return liveGraph
}

export function getAdmissionGraph() {
  if (!liveGraph) {
    return buildAdmissionGraph({
      contributors: ['host'],
      ok: false,
      failure: 'admission-unsealed',
    })
  }
  return liveGraph
}

export function getAdmissionChangeLog() {
  return changeLog.slice()
}

export function proposeLiveAdmissionChange(req) {
  const result = proposeAdmissionChange(getAdmissionGraph(), req)
  changeLog.push(result)
  return result
}

/** Test-only: drop the live seal so the next sealLiveAdmission rebuilds. */
export function resetAdmissionForTests() {
  liveGraph = null
  changeLog.length = 0
}
