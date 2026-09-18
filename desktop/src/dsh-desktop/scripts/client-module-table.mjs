#!/usr/bin/env node
/**
 * Renderer module-table rules for packaged plugin client factories.
 *
 * electron-builder (`asar: false`) copies `node_modules/**` onto disk under
 * `Contents/Resources/app/`. That is a file tree, not the loader module table.
 * The factory's injected `require()` only answers:
 *
 *   1. platform seed words (`react`, `react/jsx-runtime`, `react-dom`, `@deepseek-ai/*`)
 *   2. materialized modules (locals inlined into this factory)
 *   3. registered package factories (`window.__ModuleLoader__.load({ id })`)
 *
 * Listing `lib/*.js` as seeds or bundler externals is the wrong fix:
 * seeds are host-frozen, and `external` means "look this id up in the table".
 * A file that exists at
 * `Resources/app/node_modules/abaco-analytics/lib/summary.js` still misses
 * the table unless its bindings are materialized into the factory.
 *
 * The 0.4.22 mcp-schema-pin packaging pin (`abaco-packaged-local-imports.test.ts`)
 * only walks sibling `from '../pkg'` ESM imports so electron-builder keeps
 * root `file:` packages on disk. It cannot see `require('./lib/summary.js')`
 * inside a `__ModuleLoader__` factory.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const PLATFORM_SEED_IDS = new Set(['react', 'react/jsx-runtime', 'react-dom'])

export const MODULE_TABLE_MISS_SUFFIX =
  'missed the module table – not a platform seed word, not a materialized module, and no registered package factory (a build-time externals drift, or a dynamic dependency that did not arrive)'

const REQUIRE_CALL = /require\s*\(\s*(['"])([^'"]+)\1\s*\)/gu
const RELATIVE_ASSIGN =
  /(^|\n)([ \t]*)(?:const|let|var)\s+(?:[\w$]+|\{[\s\S]*?\})\s*=\s*require\s*\(\s*(['"])(\.\/[^'"]+|\.\.\/[^'"]+)\3\s*\)\s*;?/gu

export function isPlatformSeed(id) {
  return PLATFORM_SEED_IDS.has(id) || id === '@deepseek-ai' || id.startsWith('@deepseek-ai/')
}

export function isRelativeSpecifier(id) {
  return id.startsWith('./') || id.startsWith('../')
}

export function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|[^:])\/\/.*$/gmu, '$1')
}

export function extractRequireSpecifiers(source) {
  const ids = []
  const re = new RegExp(REQUIRE_CALL.source, REQUIRE_CALL.flags)
  let match
  while ((match = re.exec(stripComments(source))) !== null) {
    if (match[2]) ids.push(match[2])
  }
  return ids
}

export function classifyRequire(id) {
  if (isPlatformSeed(id)) return 'seed'
  if (isRelativeSpecifier(id)) return 'relative'
  return 'package'
}

export function moduleTableMiss(id) {
  return `client-modules: require(${JSON.stringify(id)}) ${MODULE_TABLE_MISS_SUFFIX}`
}

export function esmToFactoryLocals(source) {
  return source
    .replace(/^export\s+default\s+/gmu, '')
    .replace(/^export\s+\{[^}]*\}\s*;?\s*$/gmu, '')
    .replace(/^export\s+/gmu, '')
}

export function materializeRelativeRequires(clientSource, readRelative) {
  return clientSource.replace(
    RELATIVE_ASSIGN,
    (full, lead, indent, _quote, spec) => {
      const locals = esmToFactoryLocals(readRelative(spec)).replace(/\s+$/u, '')
      const indented = locals
        .split('\n')
        .map((line) => (line.length ? `${indent}${line}` : line))
        .join('\n')
      return `${lead}${indent}// Materialized from ${spec} — not a module-table seed or external.\n${indented}\n`
    }
  )
}

export function remainingRelativeRequires(clientSource) {
  return extractRequireSpecifiers(clientSource).filter((id) => classifyRequire(id) === 'relative')
}

function materializeFile(clientPath) {
  const dir = path.dirname(clientPath)
  const source = readFileSync(clientPath, 'utf8')
  const next = materializeRelativeRequires(source, (spec) =>
    readFileSync(path.resolve(dir, spec), 'utf8')
  )
  const leftover = remainingRelativeRequires(next)
  if (leftover.length > 0) {
    throw new Error(`unmaterialized relative requires: ${leftover.join(', ')}`)
  }
  writeFileSync(clientPath, next)
  return next
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2]
  const target = process.argv[3]
  if (command !== 'materialize' || !target) {
    console.error('usage: node scripts/client-module-table.mjs materialize <client.js>')
    process.exit(2)
  }
  materializeFile(path.resolve(target))
  console.log(`materialized ${target}`)
}
