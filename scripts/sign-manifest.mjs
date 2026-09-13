#!/usr/bin/env node
/**
 * sign-manifest.mjs — F1 admission manifest signer (offline, dependency-free).
 *
 * Recomputes the sha256 digests of the canonical form of every
 * packages/<plugin>/manifest.f1.yml and prints the PINNED_MANIFEST_DIGEST
 * block to paste into packages/abaco-effect-broker/index.js.
 *
 * Usage:
 *   node work/scripts/sign-manifest.mjs
 *
 * ROTATION PROCEDURE (any manifest change):
 *   1. Edit the plugin's manifest.f1.yml (review the diff — this changes admission).
 *   2. Run this script; copy the printed PINNED_MANIFEST_DIGEST block.
 *   3. Paste it over the PINNED_MANIFEST_DIGEST constant in
 *      packages/abaco-effect-broker/index.js.
 *   4. Re-run the F1 broker suite + scripts-f1/fix-admision-test.mjs.
 *   5. Commit via normal code review — changing the pin IS the trust decision
 *      (the broker source is the TCB; the pin change is visible in review).
 *
 * Security note: this script only COMPUTES digests. Trust comes from the pin
 * living in reviewed source code, never from this script's output alone.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  extractManifestCaps,
  canonicalManifestJson,
  manifestDigest,
} from '../desktop/src/dsh-desktop/packages/abaco-effect-broker/manifest-verify.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const pkgDir = join(here, '..', 'desktop', 'src', 'dsh-desktop', 'packages')
const PLUGINS = ['abaco-mediacion-pilot', 'abaco-voice']

const pins = {}
for (const id of PLUGINS) {
  const path = join(pkgDir, id, 'manifest.f1.yml')
  const text = readFileSync(path, 'utf8')
  const caps = extractManifestCaps(text)
  if (caps.id !== id) {
    console.error(`MISMATCH: file ${path} declares id "${caps.id}", expected "${id}"`)
    process.exit(1)
  }
  const canonical = canonicalManifestJson(caps)
  const digest = manifestDigest(canonical)
  pins[id] = digest
  console.log(`# ${id}`)
  console.log(`#   canonical: ${canonical}`)
  console.log(`#   sha256:    ${digest}`)
}

console.log('\n// Paste into packages/abaco-effect-broker/index.js:')
console.log('const PINNED_MANIFEST_DIGEST = {')
for (const id of PLUGINS) {
  console.log(`  '${id}': '${pins[id]}',`)
}
console.log('}')
