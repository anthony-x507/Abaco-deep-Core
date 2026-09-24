/**
 * INV-ISOLATION-CLASS — Ola 2 Bloque 2.B market gate.
 * Run from desktop/src/dsh-desktop:
 *   node --test packages/abaco-effect-broker/tests/isolation-class.test.mjs
 */
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ISOLATION_CLASS_TABLE,
  MARKET_ALLOWED_ISOLATION,
  assertMarketIsolation,
  admitMarketPluginLoad,
  gateAuthorizeIsolation,
  isMarketOrigin,
  normalizeIsolationClass,
  INV_ISOLATION_CLASS,
  LAB_ALLOW_INPROCESS_MARKET_ENV,
} from '../isolation-class.mjs'
import { authorize, resetBrokerForTests, hashArgs } from '../index.js'
import { resetAuditForTests } from '../provenance.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..', '..', '..', '..', '..')
const CONTRACT = join(REPO, 'docs', 'contracts', 'CONTRACT-INV-12.md')

const savedLab = process.env[LAB_ALLOW_INPROCESS_MARKET_ENV]

beforeEach(() => {
  delete process.env[LAB_ALLOW_INPROCESS_MARKET_ENV]
  resetBrokerForTests()
  resetAuditForTests()
})

afterEach(() => {
  if (savedLab === undefined) delete process.env[LAB_ALLOW_INPROCESS_MARKET_ENV]
  else process.env[LAB_ALLOW_INPROCESS_MARKET_ENV] = savedLab
})

test('INV-ISOLATION-CLASS table includes market ≠ in-process', () => {
  assert.equal(INV_ISOLATION_CLASS, 'INV-ISOLATION-CLASS')
  const kinds = ISOLATION_CLASS_TABLE.map((r) => r.kind)
  assert.ok(kinds.includes('market'))
  assert.ok(kinds.includes('f1-pilot'))
  assert.ok(kinds.includes('face'))
  const market = ISOLATION_CLASS_TABLE.find((r) => r.kind === 'market')
  assert.notEqual(market.isolation, 'in-process')
  assert.ok(MARKET_ALLOWED_ISOLATION.includes('utility-process'))
  assert.ok(MARKET_ALLOWED_ISOLATION.includes('strangler-fork'))
})

test('contract table documents market row', () => {
  assert.ok(existsSync(CONTRACT), `missing ${CONTRACT}`)
  const text = readFileSync(CONTRACT, 'utf8')
  assert.match(text, /INV-ISOLATION-CLASS table/)
  assert.match(text, /market/i)
  assert.match(text, /UtilityProcess|utility-process|strangler/i)
  assert.match(text, /ABACO_LAB_ALLOW_INPROCESS_MARKET/)
})

test('market + in-process → fail-closed deny', () => {
  const denied = assertMarketIsolation({
    market: true,
    isolationClass: 'in-process',
  })
  assert.equal(denied.ok, false)
  assert.equal(denied.reason, 'market-in-process-denied')

  const missing = admitMarketPluginLoad({})
  assert.equal(missing.ok, false)
  assert.equal(missing.reason, 'market-in-process-denied')
})

test('market + UtilityProcess / strangler-fork → allow', () => {
  for (const cls of ['utility-process', 'strangler-fork', 'UtilityProcess']) {
    const ok = assertMarketIsolation({ market: true, isolationClass: cls })
    assert.equal(ok.ok, true, cls)
  }
})

test('lab flag allows in-process market (explicit only)', () => {
  const env = { [LAB_ALLOW_INPROCESS_MARKET_ENV]: '1' }
  const ok = assertMarketIsolation({
    market: true,
    isolationClass: 'in-process',
    env,
  })
  assert.equal(ok.ok, true)
  assert.equal(ok.lab, true)
})

test('normalize + market origin detection', () => {
  assert.equal(normalizeIsolationClass('same-process'), 'in-process')
  assert.equal(normalizeIsolationClass('utilityProcess'), 'utility-process')
  assert.equal(isMarketOrigin({ origin: 'market' }), true)
  assert.equal(isMarketOrigin({ channel: { kind: 'cordis.host', market: true } }), true)
  assert.equal(isMarketOrigin({ channel: { kind: 'cordis.host' } }), false)
})

test('authorize denies market in-process origin', () => {
  const res = authorize({
    origin: 'market',
    isolation_class: 'in-process',
    channel: { kind: 'cordis.host', pluginId: 'abaco-voice' },
    task_id: null,
    effect: {
      kind: 'ui.slot',
      resource: 'abaco-voice',
      args_hash: hashArgs({}),
    },
    trust_in: 'user',
  })
  assert.equal(res.decision, 'deny')
  assert.equal(res.reason, 'market-in-process-denied')
})

test('gateAuthorizeIsolation allows strangler-fork market', () => {
  const gate = gateAuthorizeIsolation({
    origin: 'market',
    isolation_class: 'strangler-fork',
    channel: { kind: 'cordis.host', pluginId: 'abaco-voice' },
  })
  assert.equal(gate.ok, true)
})
