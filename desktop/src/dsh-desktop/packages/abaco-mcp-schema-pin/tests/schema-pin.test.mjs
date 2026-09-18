/**
 * F1.5 MCP schema pin/witness — fail-closed pin API + register wrap.
 *
 * Gates: un-witnessed/mutated MCP schemas cannot expand authority;
 * Atena is not in the pin or authorize hot-path; Janice = runtime;
 * no third-party connectors; disabled plugins stay disabled.
 *
 * Run: node --test tests/schema-pin.test.mjs
 * (from this package OR desktop/src/dsh-desktop)
 */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  canonicalSchemaJson,
  schemaDigest,
  pinMcpTool,
  verifyMcpToolSchema,
  detectAuthorityExpansion,
  installMcpRegisterWitness,
  isRegisterWitnessed,
  isMcpPublicName,
  parseMcpPublicName,
  getPinAuditLog,
  getPinnedTools,
  resetPinStoreForTests,
  PINNED_MCP_SCHEMAS,
  SCHEMA_PIN_REASONS,
} from '../index.js'
import {
  authorize,
  resetBrokerForTests,
  getAuditLog,
  DISABLED_PLUGINS,
  hashArgs,
} from '../../abaco-effect-broker/index.js'
import { inject as pilotInject, apply as pilotApply } from '../../abaco-mediacion-pilot/index.js'

const THIS_DIR = dirname(fileURLToPath(import.meta.url))
const PKG_DIR = resolve(THIS_DIR, '..')
const DESK = resolve(PKG_DIR, '../..')
const REPO = resolve(DESK, '../../..')

const SEARCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['q'],
  properties: {
    q: { type: 'string' },
    limit: { type: 'integer' },
  },
}

const MCP_SEARCH = 'mcp__fixture__search'

beforeEach(() => {
  resetPinStoreForTests()
  resetBrokerForTests()
})

function lastPinAudit() {
  const log = getPinAuditLog()
  return log[log.length - 1]
}

function lastBrokerAudit() {
  const log = getAuditLog()
  return log[log.length - 1]
}

/* ── G1: identity + canonical hash ─────────────────────────────────────── */

test('G1 isMcpPublicName / parse; canonical hash stable across key order', () => {
  assert.equal(isMcpPublicName('mcp__fixture__search'), true)
  assert.equal(isMcpPublicName('abaco_memory_get'), false)
  assert.deepEqual(parseMcpPublicName('mcp__fixture__search'), {
    serverName: 'fixture',
    rawName: 'search',
  })
  assert.deepEqual(parseMcpPublicName('mcp__github__create_issue'), {
    serverName: 'github',
    rawName: 'create_issue',
  })
  const a = { type: 'object', properties: { b: { type: 'string' }, a: { type: 'integer' } } }
  const b = { properties: { a: { type: 'integer' }, b: { type: 'string' } }, type: 'object' }
  assert.equal(canonicalSchemaJson(a), canonicalSchemaJson(b))
  assert.equal(schemaDigest(a), schemaDigest(b))
  assert.match(schemaDigest(a), /^[0-9a-f]{64}$/)
})

/* ── G2: pin + verify match ────────────────────────────────────────────── */

test('G2 host-attested pin then matching list = allow; shipped pin set empty', () => {
  assert.deepEqual(PINNED_MCP_SCHEMAS, {})
  assert.equal(Object.keys(PINNED_MCP_SCHEMAS).length, 0)
  const pinned = pinMcpTool({
    publicName: MCP_SEARCH,
    schema: SEARCH_SCHEMA,
    attestor: 'host',
  })
  assert.equal(pinned.ok, true)
  assert.equal(pinned.digest, schemaDigest(SEARCH_SCHEMA))
  const v = verifyMcpToolSchema({ publicName: MCP_SEARCH, schema: { ...SEARCH_SCHEMA } })
  assert.equal(v.ok, true)
  assert.equal(v.digest, pinned.digest)
  assert.equal(getPinnedTools().length, 1)
})

/* ── G3: un-witnessed fail-closed + audit ──────────────────────────────── */

test('G3 un-witnessed MCP schema → deny schema-unwitnessed + audit, 0 side-effect', () => {
  const v = verifyMcpToolSchema({ publicName: MCP_SEARCH, schema: SEARCH_SCHEMA })
  assert.equal(v.ok, false)
  assert.equal(v.reason, 'schema-unwitnessed')
  const audit = lastPinAudit()
  assert.equal(audit.decision, 'deny')
  assert.equal(audit.reason, 'schema-unwitnessed')
  assert.equal(audit.side_effect, false)
  assert.equal(audit.publicName, MCP_SEARCH)
})

/* ── G4: untrusted cannot pin ──────────────────────────────────────────── */

test('G4 plugin-data / untrusted cannot witness a schema', () => {
  for (const attestor of ['plugin-data', 'untrusted', 'aten', null, undefined]) {
    resetPinStoreForTests()
    const r = pinMcpTool({ publicName: MCP_SEARCH, schema: SEARCH_SCHEMA, attestor })
    assert.equal(r.ok, false, String(attestor))
    assert.equal(r.reason, 'schema-pin-unattested')
    assert.equal(lastPinAudit().side_effect, false)
  }
  assert.equal(getPinnedTools().length, 0)
})

/* ── G5: drift / authority expansion ───────────────────────────────────── */

test('G5 extra property and additionalProperties=true are authority expansion', () => {
  pinMcpTool({ publicName: MCP_SEARCH, schema: SEARCH_SCHEMA, attestor: 'host' })

  const extraProp = {
    ...SEARCH_SCHEMA,
    properties: { ...SEARCH_SCHEMA.properties, path: { type: 'string' } },
  }
  const expanded = detectAuthorityExpansion(SEARCH_SCHEMA, extraProp)
  assert.equal(expanded.expanded, true)
  assert.ok(expanded.findings.some((f) => f.includes("extra property 'path'")))
  const v1 = verifyMcpToolSchema({ publicName: MCP_SEARCH, schema: extraProp })
  assert.equal(v1.ok, false)
  assert.equal(v1.reason, 'schema-authority-expansion')
  assert.equal(lastPinAudit().decision, 'deny')
  assert.equal(lastPinAudit().side_effect, false)

  const open = { ...SEARCH_SCHEMA, additionalProperties: true }
  const v2 = verifyMcpToolSchema({ publicName: MCP_SEARCH, schema: open })
  assert.equal(v2.ok, false)
  assert.equal(v2.reason, 'schema-authority-expansion')
})

test('G5b required dropped / type widened = expansion; pin is write-once', () => {
  pinMcpTool({ publicName: MCP_SEARCH, schema: SEARCH_SCHEMA, attestor: 'host' })
  const dropped = { ...SEARCH_SCHEMA, required: [] }
  const v = verifyMcpToolSchema({ publicName: MCP_SEARCH, schema: dropped })
  assert.equal(v.ok, false)
  assert.equal(v.reason, 'schema-authority-expansion')

  const locked = pinMcpTool({
    publicName: MCP_SEARCH,
    schema: extraSchema(),
    attestor: 'user',
  })
  assert.equal(locked.ok, false)
  assert.equal(locked.reason, 'schema-pin-locked')
})

function extraSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['q'],
    properties: { q: { type: 'string' }, cmd: { type: 'string' } },
  }
}

test('G5c benign key-order change is not drift', () => {
  pinMcpTool({ publicName: MCP_SEARCH, schema: SEARCH_SCHEMA, attestor: 'host' })
  const reordered = {
    required: ['q'],
    additionalProperties: false,
    type: 'object',
    properties: {
      limit: { type: 'integer' },
      q: { type: 'string' },
    },
  }
  const v = verifyMcpToolSchema({ publicName: MCP_SEARCH, schema: reordered })
  assert.equal(v.ok, true)
})

/* ── G6: wrapToolsRegister ─────────────────────────────────────────────── */

test('G6 wrap: non-MCP tools pass; un-witnessed MCP throws fail-closed', () => {
  const registered = []
  const tools = {
    register(def) {
      registered.push(def.name)
      return () => {}
    },
  }
  const installed = installMcpRegisterWitness({ tools })
  assert.equal(installed.ok, true)
  assert.equal(isRegisterWitnessed(tools), true)
  assert.equal(installMcpRegisterWitness({ tools }).already, true)

  tools.register({ name: 'abaco_memory_get', parameters: { type: 'object' } })
  assert.deepEqual(registered, ['abaco_memory_get'])

  assert.throws(
    () => tools.register({ name: MCP_SEARCH, parameters: SEARCH_SCHEMA }),
    (err) => {
      assert.match(String(err.message), /fail-closed/)
      assert.equal(err.abacoPin.reason, 'schema-unwitnessed')
      return true
    },
  )
  assert.deepEqual(registered, ['abaco_memory_get'])
})

test('G6b wrap: pinned MCP registers; mutated schema is rejected (0 registry write)', () => {
  pinMcpTool({ publicName: MCP_SEARCH, schema: SEARCH_SCHEMA, attestor: 'host' })
  const registered = []
  const tools = {
    register(def) {
      registered.push(def)
      return () => {}
    },
  }
  installMcpRegisterWitness({ tools })
  tools.register({ name: MCP_SEARCH, parameters: SEARCH_SCHEMA })
  assert.equal(registered.length, 1)

  const mutated = {
    ...SEARCH_SCHEMA,
    properties: { ...SEARCH_SCHEMA.properties, shell: { type: 'string' } },
  }
  assert.throws(
    () => tools.register({ name: MCP_SEARCH, parameters: mutated }),
    (err) => err.abacoPin && err.abacoPin.reason === 'schema-authority-expansion',
  )
  assert.equal(registered.length, 1)
})

test('G6c piloto apply() installs the wrap on ctx.tools (host wiring that is in-tree)', () => {
  assert.deepEqual(pilotInject, ['tools'])
  const tools = {
    register(def) {
      return def
    },
  }
  pilotApply({ tools })
  assert.equal(isRegisterWitnessed(tools), true)
  assert.throws(() => tools.register({ name: 'mcp__evil__run', parameters: { type: 'object' } }))
})

/* ── G7: broker authorize consults the pin (MCP only) ──────────────────── */

test('G7 authorize: mcp__ tool.register without pin → schema-unwitnessed + audit', () => {
  const d = authorize({
    channel: { kind: 'host.fetch', path: '/api/abaco-voice.local-status' },
    task_id: null,
    effect: {
      kind: 'tool.register',
      resource: MCP_SEARCH,
      args_hash: hashArgs({ schema: SEARCH_SCHEMA }),
      schema: SEARCH_SCHEMA,
    },
    trust_in: 'user',
  })
  assert.equal(d.decision, 'deny')
  assert.equal(d.reason, 'schema-unwitnessed')
  const audit = lastBrokerAudit()
  assert.equal(audit.decision, 'deny')
  assert.equal(audit.reason, 'schema-unwitnessed')
  assert.equal(audit.side_effect, false)
})

test('G7b authorize: non-MCP tool.register still M5 (plugin-data cannot register)', () => {
  const d = authorize({
    channel: { kind: 'host.fetch', path: '/api/abaco-voice.local-transcribe' },
    task_id: null,
    effect: { kind: 'tool.register', resource: 'evil_tool', args_hash: 'x' },
    trust_in: 'plugin-data',
  })
  assert.equal(d.decision, 'deny')
  assert.equal(d.reason, 'skill-cannot-register-tool')
})

test('G7c authorize: pinned schema + mutated list → schema-authority-expansion', () => {
  pinMcpTool({ publicName: MCP_SEARCH, schema: SEARCH_SCHEMA, attestor: 'host' })
  const mutated = {
    ...SEARCH_SCHEMA,
    additionalProperties: true,
  }
  const d = authorize({
    channel: { kind: 'host.fetch', path: '/api/abaco-voice.local-status' },
    task_id: null,
    effect: {
      kind: 'tool.register',
      resource: MCP_SEARCH,
      args_hash: hashArgs(mutated),
      schema: mutated,
    },
    trust_in: 'user',
  })
  assert.equal(d.decision, 'deny')
  assert.equal(d.reason, 'schema-authority-expansion')
  assert.equal(lastBrokerAudit().side_effect, false)
})

/* ── G8: Atena not in hot-path; Janice = runtime ───────────────────────── */

test('G8 Atena absent from pin + authorize hot-path; atena-advise is a separate module', async () => {
  const pinSrc = await readFile(join(PKG_DIR, 'index.js'), 'utf8')
  const pinCode = pinSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.doesNotMatch(pinCode, /\batenaAdvise\b/)
  assert.doesNotMatch(pinCode, /atena-advise/)
  assert.match(pinSrc, /Janice = runtime/)

  const advise = await readFile(join(PKG_DIR, 'atena-advise.js'), 'utf8')
  assert.match(advise, /NEVER imported by `index\.js`/)
  assert.match(advise, /NEVER imported by/)

  const broker = await readFile(join(DESK, 'packages/abaco-effect-broker/index.js'), 'utf8')
  const authorizeFn = broker.slice(broker.indexOf('export function authorize'))
  assert.doesNotMatch(authorizeFn, /\bAtena\b/)
  assert.doesNotMatch(authorizeFn, /\batenaAdvise\b/)
  assert.ok(SCHEMA_PIN_REASONS.includes('schema-unwitnessed'))
})

/* ── G9: plugin-safe / no rehab / no connectors / compact lock ─────────── */

test('G9 disabled plugins stay disabled; patch has no mcp-client; compact lock intact', async () => {
  for (const id of [
    'abaco-brand',
    'abaco-device-identity',
    'abaco-cloud-sync',
    'abaco-onboarding',
    'abaco-experimental',
  ]) {
    assert.ok(DISABLED_PLUGINS.has(id), id)
  }
  const patch = await readFile(join(DESK, 'build/dsh-desktop.patch.yml'), 'utf8')
  assert.doesNotMatch(patch, /dsh-mcp-client/)
  assert.doesNotMatch(patch, /serverName:/)
  assert.match(patch, /TEMPORARILY DISABLED/)
  const pkg = await readFile(join(DESK, 'package.json'), 'utf8')
  assert.match(pkg, /"version": "0\.4\.22"/)

  const preset = await readFile(
    join(DESK, 'packages/abaco-context/presets/abaco/agent.cordis.yml'),
    'utf8',
  )
  const row = preset.match(
    /-\s*id:\s*compaction-basic[\s\S]*?thresholdRatio:\s*([0-9.]+)[\s\S]*?retainRatio:\s*([0-9.]+)[\s\S]*?maxTokens:\s*([0-9]+)/,
  )
  assert.ok(row, 'compaction-basic sigue en el preset')
  assert.equal(Number(row[1]), 0.9)
  assert.equal(Number(row[2]), 0.12)
  assert.equal(Number(row[3]), 8192)

  const contract = await readFile(join(REPO, 'docs/contracts/CONTRACT-F1.5-MCP-SCHEMA-PIN.md'), 'utf8')
  assert.match(contract, /HOST WIRING NEXT/)
  assert.match(contract, /fail-closed/)
})
