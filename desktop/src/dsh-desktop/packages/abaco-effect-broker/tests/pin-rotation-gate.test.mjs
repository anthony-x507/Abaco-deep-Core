/**
 * Ola 3 / 3.3 -- Pin rotation release gate.
 * Run from desktop/src/dsh-desktop:
 *   node --test packages/abaco-effect-broker/tests/pin-rotation-gate.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ARTIFACT_FILES,
  hashArtifactFiles,
} from '../supply-chain-admission.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = resolve(HERE, '..')
const PACKAGES = resolve(PKG, '..')
const REPO = resolve(HERE, '..', '..', '..', '..', '..', '..')
const INDEX = join(PKG, 'index.js')
const DOC = join(REPO, 'docs', 'frontier', 'PIN-ROTATION-RELEASE-GATE.md')
const SIGN = join(REPO, 'scripts', 'sign-manifest.mjs')

const SHA256_RE = /^[a-f0-9]{64}$/
const BAD_MARKERS = /\bTODO\b|\bTBD\b|\bFIXME\b|0000000000000000|changeme|replace-me/i

/**
 * @param {string} src
 * @returns {Record<string, { version: string, digest: string }>}
 */
export function parsePinnedArtifactConstants(src) {
  const start = src.indexOf('const PINNED_ARTIFACT = {')
  assert.ok(start >= 0, 'PINNED_ARTIFACT constant missing from index.js')
  const end = src.indexOf('\n}', start)
  assert.ok(end > start, 'PINNED_ARTIFACT block not closed')
  const block = src.slice(start, end + 2)
  assert.doesNotMatch(block, BAD_MARKERS, 'PINNED_ARTIFACT contains TODO/placeholder')
  /** @type {Record<string, { version: string, digest: string }>} */
  const out = {}
  const rowRe =
    /'([^']+)':\s*\{\s*version:\s*'([^']*)',\s*digest:\s*'([^']*)'\s*,?\s*\}/g
  let m
  while ((m = rowRe.exec(block)) !== null) {
    out[m[1]] = { version: m[2], digest: m[3] }
  }
  return out
}

test('pin-rotation release gate doc exists', () => {
  assert.ok(existsSync(DOC), `missing ${DOC}`)
  const text = readFileSync(DOC, 'utf8')
  assert.match(text, /release gate|PINNED_ARTIFACT|sign-manifest/i)
  assert.match(text, /review|code review|no runtime/i)
})

test('sign-manifest.mjs still documents rotation procedure', () => {
  assert.ok(existsSync(SIGN), `missing ${SIGN}`)
  const text = readFileSync(SIGN, 'utf8')
  assert.match(text, /PINNED_ARTIFACT/)
  assert.match(text, /ROTATION|rotation/)
  assert.match(text, /not Sigstore|not a Sigstore/i)
})

test('PINNED_ARTIFACT digests present, hex, non-empty, consistent with disk', () => {
  const src = readFileSync(INDEX, 'utf8')
  const pins = parsePinnedArtifactConstants(src)
  const ids = Object.keys(pins)
  assert.ok(ids.length >= 1, 'PINNED_ARTIFACT must list at least one plugin')

  for (const id of ids) {
    const row = pins[id]
    assert.ok(row.version && String(row.version).trim(), `${id}: version empty`)
    assert.ok(row.digest && String(row.digest).trim(), `${id}: digest empty`)
    assert.doesNotMatch(row.digest, BAD_MARKERS, `${id}: digest looks like placeholder`)
    assert.match(row.digest, SHA256_RE, `${id}: digest not sha256 hex`)
    assert.ok(ARTIFACT_FILES[id], `${id}: missing ARTIFACT_FILES subject list`)
    const root = join(PACKAGES, id)
    assert.ok(existsSync(root), `${id}: package dir missing at ${root}`)
    const live = hashArtifactFiles(root, ARTIFACT_FILES[id])
    assert.equal(
      live,
      row.digest,
      `${id}: PINNED_ARTIFACT digest drift vs on-disk ARTIFACT_FILES (run scripts/sign-manifest.mjs)`,
    )
  }
})

test('PINNED_MANIFEST_DIGEST entries are non-empty sha256', () => {
  const src = readFileSync(INDEX, 'utf8')
  const start = src.indexOf('const PINNED_MANIFEST_DIGEST = {')
  assert.ok(start >= 0, 'PINNED_MANIFEST_DIGEST missing')
  const end = src.indexOf('\n}', start)
  const block = src.slice(start, end + 2)
  assert.doesNotMatch(block, BAD_MARKERS)
  const re = /'([^']+)':\s*'([^']+)'/g
  let m
  let n = 0
  while ((m = re.exec(block)) !== null) {
    n += 1
    assert.match(m[2], SHA256_RE, `${m[1]}: manifest digest bad`)
  }
  assert.ok(n >= 1, 'no manifest pins parsed')
})
