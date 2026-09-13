/**
 * F1 manifest verification (TCB — part of abaco-effect-broker).
 *
 * The plugin admission manifests (manifest.f1.yml) are the single source of
 * truth for admission caps. The broker consumes them only after verifying
 * integrity against the pinned digests in index.js (PINNED_MANIFEST_DIGEST).
 *
 * Canonicalization: the manifests follow a FIXED, known schema —
 *   id: <string>
 *   tier_isolation: <string>
 *   caps:
 *     effects: [a, b]            (flow list)  OR block list
 *     resources:                 (block list with "- " items, or flow list)
 *       - x
 *     trust_ceiling: <string>
 *   admission:
 *     inject: [a]                (flow list; fallback: caps.inject)
 *     note: "..."                (ignored by digest)
 *
 * js-yaml is intentionally NOT a dependency here (TCB stays dependency-free):
 * this module implements a minimal parser for exactly this schema. Anything
 * outside the schema throws → verification fails → broker goes fail-closed.
 *
 * Canonical form: JSON with sorted keys and sorted arrays, hashed with
 * sha256. Array order in the manifest does not affect the digest; any
 * added/removed/renamed value does.
 */

import { createHash } from 'node:crypto'

function stripComment(line) {
  let inS = false
  let inD = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === "'" && !inD) inS = !inS
    else if (c === '"' && !inS) inD = !inD
    else if (c === '#' && !inS && !inD) return line.slice(0, i)
  }
  return line
}

function parseScalar(v) {
  v = v.trim()
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    const q = v[0]
    let inner = v.slice(1, -1)
    if (q === '"') inner = inner.replace(/\\(.)/g, '$1')
    return inner
  }
  return v
}

function parseFlowList(v) {
  const inner = v.trim().slice(1, -1).trim()
  if (!inner) return []
  const items = []
  let cur = ''
  let inS = false
  let inD = false
  for (const c of inner) {
    if (c === "'" && !inD) inS = !inS
    else if (c === '"' && !inS) inD = !inD
    else if (c === ',' && !inS && !inD) {
      items.push(parseScalar(cur))
      cur = ''
      continue
    }
    cur += c
  }
  items.push(parseScalar(cur))
  return items.filter((s) => s !== '')
}

function parseValue(v) {
  v = (v || '').trim()
  if (v === '') return undefined // key with nested block/list below
  if (v.startsWith('[') && v.endsWith(']')) return parseFlowList(v)
  return parseScalar(v)
}

/**
 * Parse manifest.f1.yml (fixed schema only). Throws on anything unexpected.
 * @returns {{ id: string, tier_isolation?: string, caps?: object, admission?: object }}
 */
export function parseManifestYaml(text) {
  const doc = {}
  let section = null
  let pendingListKey = null
  for (const raw of String(text).split('\n')) {
    const line = stripComment(raw)
    if (!line.trim()) continue
    const indent = line.match(/^ */)[0].length
    const t = line.trim()
    if (indent === 0) {
      section = null
      pendingListKey = null
      if (t.endsWith(':') && !t.includes(' ')) {
        section = t.slice(0, -1)
        if (section !== 'caps' && section !== 'admission') {
          throw new Error(`manifest yaml: unexpected section "${section}"`)
        }
        doc[section] = {}
        continue
      }
      const m = t.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
      if (!m) throw new Error(`manifest yaml: bad line "${t}"`)
      doc[m[1]] = parseValue(m[2])
    } else {
      if (!section) throw new Error(`manifest yaml: unexpected indent "${t}"`)
      if (t.startsWith('- ')) {
        if (!pendingListKey) throw new Error(`manifest yaml: list item without key "${t}"`)
        doc[section][pendingListKey].push(parseScalar(t.slice(2)))
        continue
      }
      const m = t.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
      if (!m) throw new Error(`manifest yaml: bad nested line "${t}"`)
      const v = parseValue(m[2])
      if (v === undefined) {
        pendingListKey = m[1]
        doc[section][pendingListKey] = []
      } else {
        doc[section][m[1]] = v
        pendingListKey = null
      }
    }
  }
  return doc
}

/**
 * Extract the admission-relevant caps from manifest text.
 * @returns {{ id, tier_isolation, effects[], resources[], trust_ceiling, inject[] }}
 */
export function extractManifestCaps(text) {
  const doc = parseManifestYaml(text)
  const caps = doc.caps || {}
  const admission = doc.admission || {}
  const str = (x) => String(x ?? '')
  const arr = (x) => (Array.isArray(x) ? x.map(String) : [])
  if (!doc.id || !str(doc.id)) throw new Error('manifest: missing id')
  return {
    id: str(doc.id),
    tier_isolation: str(doc.tier_isolation),
    effects: arr(caps.effects),
    resources: arr(caps.resources),
    trust_ceiling: str(caps.trust_ceiling),
    inject: arr(admission.inject ?? caps.inject),
  }
}

/** Stable serialization: sorted keys, sorted arrays. */
export function canonicalManifestJson(caps) {
  const c = {
    effects: [...caps.effects].sort(),
    id: caps.id,
    inject: [...caps.inject].sort(),
    resources: [...caps.resources].sort(),
    tier_isolation: caps.tier_isolation,
    trust_ceiling: caps.trust_ceiling,
  }
  return JSON.stringify(c)
}

export function manifestDigest(canonicalJson) {
  return createHash('sha256').update(canonicalJson, 'utf8').digest('hex')
}

/**
 * Verify manifest text against a pinned digest.
 * @returns {{ ok: true, caps, digest, canonical } | { ok: false, reason }}
 */
export function verifyManifest(text, pinnedDigest, expectedId) {
  let caps
  try {
    caps = extractManifestCaps(text)
  } catch (e) {
    return { ok: false, reason: `manifest-unparseable: ${e.message}` }
  }
  if (expectedId && caps.id !== expectedId) {
    return { ok: false, reason: `manifest-id-mismatch: got "${caps.id}", want "${expectedId}"` }
  }
  const canonical = canonicalManifestJson(caps)
  const digest = manifestDigest(canonical)
  if (digest !== pinnedDigest) {
    return { ok: false, reason: `manifest-digest-mismatch: got ${digest.slice(0, 16)}…, want ${String(pinnedDigest).slice(0, 16)}…` }
  }
  return { ok: true, caps, digest, canonical }
}
