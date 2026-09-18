/**
 * Host apply() must degrade / warn / skip — never throw into Cordis.
 *
 * Run: node --test packages/abaco-voice/tests/apply-degrade.test.mjs
 * (from desktop/src/dsh-desktop)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply as applyVoice, LOCAL_STATUS_PATH, LOCAL_TRANSCRIBE_PATH } from '../index.js'
import { apply as applyDocuments, EXTRACT_PATH } from '../../abaco-documents/index.js'
import { apply as applyObservability } from '../../abaco-observability/index.js'

function capturingLogger() {
  const warnings = []
  return {
    warnings,
    warn: (message) => {
      warnings.push(String(message))
    },
    info: () => {},
  }
}

test('abaco-voice apply() skips when connection.fetch is missing (no throw)', () => {
  const logger = capturingLogger()
  assert.doesNotThrow(() => applyVoice({ logger }))
  assert.doesNotThrow(() => applyVoice({ logger, connection: {} }))
  assert.doesNotThrow(() => applyVoice(null))
  assert.ok(logger.warnings.some((line) => line.includes('connection.fetch registry is unavailable')))
})

test('abaco-voice apply() still registers both routes on the happy path', () => {
  const registry = []
  applyVoice({
    connection: {
      fetch: {
        register: (entry) => {
          registry.push(entry)
        },
      },
    },
  })
  assert.ok(registry.some((entry) => entry.path === LOCAL_STATUS_PATH))
  assert.ok(registry.some((entry) => entry.path === LOCAL_TRANSCRIBE_PATH))
})

test('abaco-documents apply() skips when connection.fetch is missing (no throw)', () => {
  const logger = capturingLogger()
  assert.doesNotThrow(() => applyDocuments({ logger }))
  assert.doesNotThrow(() => applyDocuments(null))
  assert.ok(logger.warnings.some((line) => line.includes('connection.fetch registry is unavailable')))
})

test('abaco-documents apply() still registers the extract route on the happy path', () => {
  const registry = []
  applyDocuments({
    connection: {
      fetch: {
        register: (entry) => {
          registry.push(entry)
        },
      },
    },
  })
  assert.ok(registry.some((entry) => entry.path === EXTRACT_PATH))
})

test('abaco-observability apply() skips when inject is missing or throws (no throw)', () => {
  const logger = capturingLogger()
  assert.doesNotThrow(() => applyObservability({ logger }, {}))
  assert.ok(logger.warnings.some((line) => line.includes('ctx.inject is unavailable')))

  const throwing = capturingLogger()
  assert.doesNotThrow(() =>
    applyObservability(
      {
        logger: throwing,
        inject: () => {
          throw new Error('Invalid effect')
        },
      },
      {},
    ),
  )
  assert.ok(throwing.warnings.some((line) => line.includes('telemetry could not start')))
})
