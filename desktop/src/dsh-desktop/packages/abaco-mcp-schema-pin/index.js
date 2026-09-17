/**
 * F1.5 MCP schema pin/witness.
 *
 * Hash/pin registered MCP tool schemas (`mcp__<server>__<tool>`). A mutated
 * or un-witnessed schema cannot expand authority: verify is fail-closed.
 * Janice = runtime (this module + wrap on `ctx.tools.register`).
 * Atena = asesor — this file does not import `atena-advise.js`.
 *
 * Built-in pin set is empty: no third-party MCP connectors are enabled.
 *
 * @module abaco-mcp-schema-pin
 */

import { createHash } from 'node:crypto'
import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

/** @typedef {'schema-unwitnessed'|'schema-drift'|'schema-authority-expansion'|'schema-pin-unattested'|'schema-pin-locked'|'schema-missing'} PinReason */

export const SCHEMA_PIN_REASONS = Object.freeze([
  'schema-unwitnessed',
  'schema-drift',
  'schema-authority-expansion',
  'schema-pin-unattested',
  'schema-pin-locked',
  'schema-missing',
])

/**
 * Shipped witness set. Empty on purpose: F1.5 does not enable third-party
 * MCP connectors. Host-attested `pinMcpTool` is the only way a schema lands.
 */
export const PINNED_MCP_SCHEMAS = Object.freeze({})

const WITNESS_MARK = Symbol.for('abaco.mcpSchemaPin.witness')

/** @type {Map<string, { publicName: string, digest: string, schema: any, attestor: string }>} */
const pins = new Map()
/** @type {any[]} */
const auditLog = []

export function resetPinStoreForTests() {
  pins.clear()
  auditLog.length = 0
}

export function getPinAuditLog() {
  return auditLog.slice()
}

export function getPinnedTools() {
  return [...pins.entries()].map(([publicName, rec]) => ({
    publicName,
    digest: rec.digest,
    attestor: rec.attestor,
  }))
}

export function isMcpPublicName(name) {
  return typeof name === 'string' && name.startsWith('mcp__')
}

/**
 * `mcp__<server>__<raw>` — server is the first segment; raw may contain `_`.
 * @returns {{ serverName: string, rawName: string } | null}
 */
export function parseMcpPublicName(name) {
  if (!isMcpPublicName(name)) return null
  const rest = name.slice('mcp__'.length)
  const split = rest.indexOf('__')
  if (split <= 0 || split === rest.length - 2) return null
  return { serverName: rest.slice(0, split), rawName: rest.slice(split + 2) }
}

/** Recursively sort object keys → deterministic JSON for hashing. */
export function canonicalSchemaJson(value) {
  return stringifyCanonical(value)
}

function stringifyCanonical(value) {
  if (value === undefined) return 'null'
  if (value === null) return 'null'
  const t = typeof value
  if (t === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null'
  if (t === 'boolean' || t === 'string') return JSON.stringify(value)
  if (t !== 'object') return 'null'
  if (Array.isArray(value)) return '[' + value.map(stringifyCanonical).join(',') + ']'
  const keys = Object.keys(value).sort()
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stringifyCanonical(value[k])).join(',') + '}'
}

export function schemaDigest(schema) {
  return createHash('sha256').update(canonicalSchemaJson(schema), 'utf8').digest('hex')
}

function cloneJson(value) {
  return value === undefined ? null : JSON.parse(JSON.stringify(value))
}

function pushPinAudit(ev) {
  auditLog.push(ev)
  const home = process.env.DSH_HOME || process.env.HOME
  if (!home) return
  const dir = join(home, 'abaco-deep-core-audit-f1')
  const line = JSON.stringify(ev) + '\n'
  mkdir(dir, { recursive: true })
    .then(() => appendFile(join(dir, 'mcp-schema.jsonl'), line).catch(() => {}))
    .catch(() => {})
}

function denyPin(reason, extra = {}) {
  const ev = {
    ts: Date.now(),
    decision: 'deny',
    reason,
    side_effect: false,
    ...extra,
  }
  pushPinAudit(ev)
  return { ok: false, reason, audit: ev }
}

/**
 * Detect whether `listed` expands authority relative to `pinned`.
 * Hash mismatch still fails closed even when this returns expanded:false
 * (tightening a schema is still drift).
 */
export function detectAuthorityExpansion(pinned, listed) {
  const findings = []
  walkExpansion(pinned, listed, '$', findings)
  return { expanded: findings.length > 0, findings }
}

function walkExpansion(pinned, listed, path, findings) {
  if (listed === undefined || listed === null) return
  if (pinned === undefined || pinned === null) {
    findings.push(`${path}: listed present, pinned absent`)
    return
  }
  if (typeof listed !== 'object' || typeof pinned !== 'object') {
    if (listed !== pinned) findings.push(`${path}: value changed`)
    return
  }
  if (Array.isArray(listed) || Array.isArray(pinned)) {
    if (!Array.isArray(listed) || !Array.isArray(pinned)) {
      findings.push(`${path}: array/object mismatch`)
      return
    }
    if (path.endsWith('.enum') && listed.some((v) => !pinned.includes(v))) {
      findings.push(`${path}: extra enum values`)
    }
    if (listed.length > pinned.length && !path.endsWith('.enum')) {
      findings.push(`${path}: extra array items`)
    }
    const n = Math.min(listed.length, pinned.length)
    for (let i = 0; i < n; i++) walkExpansion(pinned[i], listed[i], `${path}[${i}]`, findings)
    return
  }

  if (listed.additionalProperties === true && pinned.additionalProperties !== true) {
    findings.push(`${path}: additionalProperties enabled`)
  }

  const pinnedType = normalizeType(pinned.type)
  const listedType = normalizeType(listed.type)
  if (listedType.length > 0 && pinnedType.length > 0) {
    if (listedType.some((t) => !pinnedType.includes(t))) {
      findings.push(`${path}: type widened (${pinnedType.join('|')} → ${listedType.join('|')})`)
    }
  } else if (pinnedType.length > 0 && listedType.length === 0) {
    findings.push(`${path}: type constraint removed`)
  }

  const pinnedReq = Array.isArray(pinned.required) ? pinned.required : []
  const listedReq = Array.isArray(listed.required) ? listed.required : []
  for (const r of pinnedReq) {
    if (!listedReq.includes(r)) findings.push(`${path}: required '${r}' dropped`)
  }

  const pinnedProps = pinned.properties && typeof pinned.properties === 'object' ? pinned.properties : {}
  const listedProps = listed.properties && typeof listed.properties === 'object' ? listed.properties : {}
  for (const key of Object.keys(listedProps)) {
    if (!Object.prototype.hasOwnProperty.call(pinnedProps, key)) {
      findings.push(`${path}: extra property '${key}'`)
    } else {
      walkExpansion(pinnedProps[key], listedProps[key], `${path}.properties.${key}`, findings)
    }
  }

  if (listed.items !== undefined) {
    walkExpansion(pinned.items, listed.items, `${path}.items`, findings)
  }
}

function normalizeType(t) {
  if (t == null) return []
  return (Array.isArray(t) ? t : [t]).map(String)
}

/**
 * Host/user-attested pin. plugin-data / untrusted cannot witness a schema.
 * Write-once per publicName unless `rotate: true` and attestor is `host`.
 */
export function pinMcpTool({ publicName, schema, attestor, rotate = false } = {}) {
  if (!isMcpPublicName(publicName)) {
    return denyPin('schema-missing', { publicName: publicName || null })
  }
  if (attestor !== 'host' && attestor !== 'user') {
    return denyPin('schema-pin-unattested', { publicName, attestor: attestor || null })
  }
  if (schema === undefined) {
    return denyPin('schema-missing', { publicName })
  }
  const existing = pins.get(publicName)
  const digest = schemaDigest(schema)
  if (existing && existing.digest !== digest) {
    if (!(rotate === true && attestor === 'host')) {
      return denyPin('schema-pin-locked', {
        publicName,
        pinned: existing.digest,
        attempted: digest,
      })
    }
  }
  const rec = {
    publicName,
    digest,
    schema: cloneJson(schema),
    attestor,
  }
  pins.set(publicName, rec)
  const ev = {
    ts: Date.now(),
    decision: 'allow',
    reason: existing ? 'schema-pin-rotated' : 'schema-pinned',
    publicName,
    digest,
    attestor,
    side_effect: false,
  }
  pushPinAudit(ev)
  return { ok: true, digest, publicName, audit: ev }
}

/**
 * Fail-closed verify of a listed MCP tool schema against the witness set.
 *
 * @param {{ publicName: string, schema?: any, schemaHash?: string }} listed
 */
export function verifyMcpToolSchema(listed = {}) {
  const publicName = listed.publicName
  if (!isMcpPublicName(publicName)) {
    return { ok: true, skipped: true }
  }
  const pin = pins.get(publicName)
  if (!pin) {
    return denyPin('schema-unwitnessed', { publicName })
  }
  const hasSchema = listed.schema !== undefined
  const hasHash = typeof listed.schemaHash === 'string' && listed.schemaHash.length > 0
  if (!hasSchema && !hasHash) {
    // Execute-time: registration already witnessed this name.
    return { ok: true, digest: pin.digest, execute: true }
  }
  const digest = hasHash && !hasSchema ? listed.schemaHash : schemaDigest(listed.schema)
  if (digest !== pin.digest) {
    const expansion = hasSchema
      ? detectAuthorityExpansion(pin.schema, listed.schema)
      : { expanded: true, findings: ['hash mismatch without schema body'] }
    const reason = expansion.expanded ? 'schema-authority-expansion' : 'schema-drift'
    return denyPin(reason, {
      publicName,
      pinned: pin.digest,
      listed: digest,
      expansion: expansion.findings,
    })
  }
  return { ok: true, digest, publicName }
}

/**
 * Wrap `ctx.tools.register` on the shared tools service.
 * Non-MCP tools (abaco_*, stock) pass through. MCP names fail closed.
 * Mutates the service object so later mcp-client instances hit the same wrap.
 *
 * @returns {{ ok: boolean, already?: boolean, reason?: string }}
 */
export function installMcpRegisterWitness(ctx, storeInstall = { used: true }) {
  const tools = ctx && ctx.tools
  if (!tools || typeof tools.register !== 'function') {
    return { ok: false, reason: 'tools-service-missing' }
  }
  if (tools[WITNESS_MARK]) return { ok: true, already: true }
  const original = tools.register.bind(tools)
  tools.register = function abacoMcpSchemaWitnessRegister(definition) {
    const name = definition && definition.name
    if (isMcpPublicName(name)) {
      const verdict = verifyMcpToolSchema({
        publicName: name,
        schema: definition.parameters !== undefined ? definition.parameters : definition.inputSchema,
      })
      if (!verdict.ok) {
        const err = new Error(`mcp-schema-pin fail-closed: ${verdict.reason}`)
        err.abacoPin = verdict
        throw err
      }
    }
    return original(definition)
  }
  Object.defineProperty(tools, WITNESS_MARK, { value: true, enumerable: false, configurable: true })
  void storeInstall
  return { ok: true, already: false }
}

export function isRegisterWitnessed(tools) {
  return !!(tools && tools[WITNESS_MARK])
}
