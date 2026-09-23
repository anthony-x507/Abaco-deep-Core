/**
 * INV-KILL-DRAINS (Ola 1 / Bloque 3 item 3.3 — deep runner path)
 * Source-lock: mediacion ops.run drains pipes concurrently; no wait-before-drain.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MAX_CHILD_OUTPUT_BYTES } from '../ops.js'

const THIS_DIR = dirname(fileURLToPath(import.meta.url))

test('INV-KILL-DRAINS · ops.run attaches readers before close; caps output', async () => {
  assert.ok(MAX_CHILD_OUTPUT_BYTES > 0)
  const src = await readFile(join(THIS_DIR, '..', 'ops.js'), 'utf8')
  assert.match(src, /INV-KILL-DRAINS/)
  assert.match(src, /child\.stdout\.on\('data'/)
  assert.match(src, /child\.stderr\.on\('data'/)
  assert.match(src, /child\.on\('close'/)
  // Forbid classic wait-then-drain ordering on this runner.
  assert.doesNotMatch(src, /\.wait\s*\(/)
  assert.doesNotMatch(src, /proc\.wait/)
  const dataIdx = src.indexOf("child.stdout.on('data'")
  const closeIdx = src.indexOf("child.on('close'")
  assert.ok(dataIdx > 0 && closeIdx > dataIdx, 'drain listeners must precede close handler')
})
