/**
 * Supply-chain admission gate (Test C — digest pin + SBOM).
 *
 * CODE decides. A version/tag match is not a pin. A prompt, Jev score, or
 * Atena note is not a grant and is ignored. Missing or incomplete SBOM is
 * HOLD (not admit). Digest / identity mismatches are deny.
 *
 * The artifact subject is the shippable source set declared in
 * {@link ARTIFACT_FILES} (this module is broker TCB). `sbom.admission.json`
 * is a predicate over that subject, not part of the hashed bytes.
 *
 * `author_signature` is a digest-binding stamp (Ola 3 D6 adds builder-id bind in d6-provenance-stamp.mjs; still not Sigstore)
 * (sha256 of producer, plugin id, and component hash). It is not a Sigstore
 * or in-toto signature. Cryptographic author authentication stays a GAP.
 *
 * @module abaco-effect-broker/supply-chain-admission
 */

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

/** Host verifier packages. Their bytes are not re-pinned inside plugin admit. */
export const HOST_TCB = Object.freeze([
  'abaco-effect-broker',
  'abaco-mcp-schema-pin',
])

/** Engine peer that is the host, not a plugin artifact. */
export const HOST_PEERS = Object.freeze(['@deepseek-ai/cordis'])

const HOST_TCB_SET = new Set(HOST_TCB)
const HOST_PEER_SET = new Set(HOST_PEERS)

/**
 * Shippable files hashed into the artifact digest, relative to the package
 * root, sorted. Tests and markdown are outside the subject. Any other
 * shippable file on disk is `artifact-unexpected-file` (fail closed).
 */
export const ARTIFACT_FILES = Object.freeze({
  'abaco-mediacion-pilot': Object.freeze([
    'index.js',
    'manifest.f1.yml',
    'ops.js',
    'package.json',
    'worker.js',
  ]),
  'abaco-voice': Object.freeze([
    'client.js',
    'index.js',
    'lib/composer-mic.js',
    'lib/normalize-config.js',
    'lib/playback.js',
    'lib/providers/deepgram.js',
    'lib/providers/edge.js',
    'lib/providers/elevenlabs.js',
    'lib/providers/openai.js',
    'lib/providers/web-speech.js',
    'lib/recorder.js',
    'lib/registry.js',
    'lib/storage.js',
    'lib/stt-mac-contract.js',
    'manifest.f1.yml',
    'package.json',
  ]),
})

const SKIP_DIRS = new Set(['tests', 'node_modules'])

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

/**
 * Binding stamp over producer + plugin id + component hash.
 * Not an authenticating signature.
 * @param {string} producer
 * @param {string} pluginId
 * @param {string} componentHash
 */
export function authorBinding(producer, pluginId, componentHash) {
  return sha256(`${producer}\n${pluginId}\n${componentHash}`)
}

function closed(decision, reason, extra = {}) {
  return Object.freeze({
    decision,
    reason,
    side_effect: false,
    admitted: decision === 'admit',
    advisor_ignored: extra.advisor_ignored === true,
    prompt_ignored: extra.prompt_ignored === true,
  })
}

function ignoredFlags(input) {
  const advisor = typeof input.advisor === 'string' ? input.advisor.toLowerCase() : ''
  return {
    advisor_ignored: advisor === 'jev' || advisor === 'atena' || advisor === 'janice',
    prompt_ignored: typeof input.prompt === 'string' && input.prompt.length > 0,
  }
}

/**
 * @param {string[]} present
 * @param {string[]} expected
 */
export function compareFileSets(present, expected) {
  const p = new Set(present)
  const e = new Set(expected)
  return {
    missing: [...e].filter((x) => !p.has(x)).sort(),
    extra: [...p].filter((x) => !e.has(x)).sort(),
  }
}

/**
 * Pure admission decision. Never reads the advisor or the prompt as authority.
 *
 * @param {object} input
 * @returns {{ decision: 'admit'|'deny'|'hold', reason: string, side_effect: false, admitted: boolean }}
 */
export function decideSupplyChainAdmission(input) {
  const src = input && typeof input === 'object' ? input : {}
  const flags = ignoredFlags(src)
  const pluginId = typeof src.pluginId === 'string' ? src.pluginId : ''
  const pinnedPluginId = typeof src.pinnedPluginId === 'string' ? src.pinnedPluginId : ''
  if (!pluginId || !pinnedPluginId) return closed('deny', 'no-identity', flags)
  if (pluginId !== pinnedPluginId) return closed('deny', 'identity-mismatch', flags)

  const artifactDigest = typeof src.artifactDigest === 'string' ? src.artifactDigest : ''
  const pinnedDigest = typeof src.pinnedDigest === 'string' ? src.pinnedDigest : ''
  if (!/^[a-f0-9]{64}$/.test(artifactDigest) || !/^[a-f0-9]{64}$/.test(pinnedDigest)) {
    return closed('deny', 'digest-missing', flags)
  }
  if (artifactDigest !== pinnedDigest) {
    const version = typeof src.version === 'string' ? src.version : ''
    const pinnedVersion = typeof src.pinnedVersion === 'string' ? src.pinnedVersion : ''
    const reason =
      version && pinnedVersion && version === pinnedVersion
        ? 'tag-match-digest-mismatch'
        : 'digest-mismatch'
    return closed('deny', reason, flags)
  }

  if (src.sbom == null) return closed('hold', 'sbom-missing', flags)
  if (typeof src.sbom !== 'object' || Array.isArray(src.sbom)) {
    return closed('hold', 'sbom-unparseable', flags)
  }
  const shape = sbomShape(src.sbom, pluginId, artifactDigest)
  if (shape) return closed(shape.decision, shape.reason, flags)

  if (!Array.isArray(src.packageDependencyNames)) {
    return closed('hold', 'sbom-incomplete', flags)
  }
  const dep = dependencyCoverage(
    src.sbom,
    src.packageDependencyNames,
    src.knownArtifactPins && typeof src.knownArtifactPins === 'object' ? src.knownArtifactPins : {},
  )
  if (dep) return closed(dep.decision, dep.reason, flags)

  return closed('admit', 'ok', flags)
}

function sbomShape(sbom, pluginId, artifactDigest) {
  if (sbom.format !== 'abaco-admission-sbom-v1') return { decision: 'hold', reason: 'sbom-incomplete' }
  if (sbom.plugin_id !== pluginId) return { decision: 'deny', reason: 'sbom-identity-mismatch' }
  if (sbom.hash_algorithm !== 'sha256') return { decision: 'hold', reason: 'sbom-incomplete' }
  if (sbom.component_hash !== artifactDigest) return { decision: 'deny', reason: 'sbom-hash-mismatch' }
  if (typeof sbom.producer !== 'string' || !sbom.producer.trim()) {
    return { decision: 'hold', reason: 'sbom-incomplete' }
  }
  if (typeof sbom.generation_context !== 'string' || !sbom.generation_context.trim()) {
    return { decision: 'hold', reason: 'sbom-incomplete' }
  }
  if (typeof sbom.timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(sbom.timestamp)) {
    return { decision: 'hold', reason: 'sbom-incomplete' }
  }
  if (!Array.isArray(sbom.dependencies)) return { decision: 'hold', reason: 'sbom-incomplete' }
  const binding = authorBinding(sbom.producer, pluginId, artifactDigest)
  if (sbom.author_signature !== binding) return { decision: 'deny', reason: 'sbom-binding-mismatch' }
  return null
}

function dependencyCoverage(sbom, declaredNames, knownPins) {
  const declared = [...new Set(declaredNames.map(String))].sort()
  const entries = sbom.dependencies
  const byName = new Map()
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string' || !entry.name) {
      return { decision: 'hold', reason: 'sbom-incomplete' }
    }
    if (byName.has(entry.name)) return { decision: 'hold', reason: 'sbom-incomplete' }
    byName.set(entry.name, entry)
  }
  for (const name of byName.keys()) {
    if (!declared.includes(name)) return { decision: 'hold', reason: 'sbom-undeclared-dependency' }
  }
  for (const name of declared) {
    const entry = byName.get(name)
    if (!entry) return { decision: 'hold', reason: 'sbom-dependency-omitted' }
    if (HOST_TCB_SET.has(name)) {
      if (entry.scope !== 'host-tcb') return { decision: 'hold', reason: 'sbom-incomplete' }
      continue
    }
    if (HOST_PEER_SET.has(name)) {
      if (entry.scope !== 'host-peer') return { decision: 'hold', reason: 'sbom-incomplete' }
      continue
    }
    const hash = entry.hash
    if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash) || hash === 'unknown') {
      return { decision: 'hold', reason: 'sbom-unknown-hash' }
    }
    if (!Object.prototype.hasOwnProperty.call(knownPins, name) || knownPins[name] !== hash) {
      return { decision: 'hold', reason: 'sbom-unpinned-dependency' }
    }
  }
  return null
}

function isShippable(rel) {
  if (rel === 'sbom.admission.json') return false
  if (rel.endsWith('.md')) return false
  return rel.endsWith('.js') || rel.endsWith('.mjs') || rel.endsWith('.cjs') || rel === 'manifest.f1.yml' || rel === 'package.json'
}

/** Relative shippable paths actually on disk (tests/ and markdown excluded). */
export function listArtifactFiles(root) {
  const out = []
  const walk = (dir) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (ent.name.startsWith('.')) continue
      const abs = join(dir, ent.name)
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue
        walk(abs)
        continue
      }
      if (!ent.isFile()) continue
      const rel = relative(root, abs).split('\\').join('/')
      if (isShippable(rel)) out.push(rel)
    }
  }
  walk(root)
  out.sort()
  return out
}

/** sha256 over sorted path + NUL + bytes + NUL. */
export function hashArtifactFiles(root, relativePaths) {
  const h = createHash('sha256')
  for (const rel of [...relativePaths].sort()) {
    const bytes = readFileSync(join(root, rel))
    h.update(rel)
    h.update('\0')
    h.update(bytes)
    h.update('\0')
  }
  return h.digest('hex')
}

export function readPackageDependencyNames(root) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const deps = Object.keys(pkg.dependencies || {})
  const peers = Object.keys(pkg.peerDependencies || {})
  return {
    name: typeof pkg.name === 'string' ? pkg.name : '',
    version: typeof pkg.version === 'string' ? pkg.version : '',
    packageDependencyNames: [...new Set([...deps, ...peers])].sort(),
  }
}

/**
 * Hash the on-disk subject and run {@link decideSupplyChainAdmission}.
 * Missing SBOM file → HOLD `sbom-missing`. Unparseable SBOM → HOLD.
 *
 * @param {string} root package directory
 * @param {{ pluginId: string, version: string, digest: string, knownArtifactPins?: Record<string, string> }} spec
 */
export function evaluatePluginTree(root, spec) {
  const pluginId = spec.pluginId
  const expected = ARTIFACT_FILES[pluginId]
  if (!expected) {
    return closed('deny', 'not-pinned', {})
  }
  let present
  try {
    present = listArtifactFiles(root)
  } catch (e) {
    return closed('deny', 'artifact-unreadable', {})
  }
  const diff = compareFileSets(present, expected)
  if (diff.missing.length) return closed('deny', 'artifact-missing-file', {})
  if (diff.extra.length) return closed('deny', 'artifact-unexpected-file', {})

  let artifactDigest
  let pkgInfo
  try {
    artifactDigest = hashArtifactFiles(root, expected)
    pkgInfo = readPackageDependencyNames(root)
  } catch {
    return closed('deny', 'artifact-unreadable', {})
  }

  const sbomPath = join(root, 'sbom.admission.json')
  let sbom = null
  if (!existsSync(sbomPath)) {
    sbom = null
  } else {
    try {
      sbom = JSON.parse(readFileSync(sbomPath, 'utf8'))
    } catch {
      return closed('hold', 'sbom-unparseable', {})
    }
  }

  return decideSupplyChainAdmission({
    pluginId,
    pinnedPluginId: pluginId,
    packageName: pkgInfo.name,
    version: pkgInfo.version,
    pinnedVersion: spec.version,
    artifactDigest,
    pinnedDigest: spec.digest,
    sbom,
    packageDependencyNames: pkgInfo.packageDependencyNames,
    knownArtifactPins: spec.knownArtifactPins || {},
  })
}
