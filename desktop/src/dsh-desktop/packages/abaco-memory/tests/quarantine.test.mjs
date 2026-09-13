/**
 * F2.1 Pack A · deterministic gate tests for the MemoryStore quarantine.
 *
 * Covers gates G1–G7 + Q1/Q2 against the REAL store (lib/store.js wired to
 * lib/quarantine.js), with a fresh MemoryStore per test in its own tmpdir.
 *
 * Run: node --test tests/quarantine.test.mjs
 * (from desktop/src/dsh-desktop)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MemoryStore } from '../lib/store.js'
import { renderMemory } from '../lib/render.js'
import {
  MEMORY_TRUST,
  initialStateFor,
  isQuarantined,
  reviewerCanPromote,
  trustOf
} from '../lib/quarantine.js'
import { MemorySchemaError } from '../lib/schema.js'

const THIS_DIR = dirname(fileURLToPath(import.meta.url))
const PKG_DIR = resolve(THIS_DIR, '..')

/** A brand-new store in a brand-new tmpdir: no shared state between tests. */
async function freshStore() {
  const root = await mkdtemp(join(tmpdir(), 'abaco-mem-q-'))
  return new MemoryStore({ root })
}

/** Parse the append-only audit journal (<root>/audit/memory.jsonl). */
async function journalLines(store) {
  let text = ''
  try {
    text = await readFile(store.auditPath, 'utf8')
  } catch {
    return []
  }
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line))
}

function countOp(lines, op) {
  return lines.filter((line) => line.op === op).length
}

async function pathExists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function quarantineEntry(store, id) {
  return store
    .peek('profile', '')
    ?.facets?.preferences_user?.find((entry) => entry.id === id)
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof MemorySchemaError, `expected a MemorySchemaError, got ${String(err)}`)
    assert.equal(err.code, code)
    return true
  })
}

/* ── G1: write without trust → deny, audited, nothing persisted ─────────── */

test('G1.1 write con trust explícito inválido → MEMORY_NO_TRUST + deny auditado + nada persistido', async () => {
  const store = await freshStore()
  await expectCode(
    store.set({ path: 'preferences_user[+]', value: 'dato', source: 'agent:turn-1', trust: 'bogus' }),
    'MEMORY_NO_TRUST'
  )
  const lines = await journalLines(store)
  const denies = lines.filter((line) => line.op === 'deny' && line.reason === 'MEMORY_NO_TRUST')
  assert.equal(denies.length, 1)
  assert.equal(denies[0].trust, 'bogus')
  // Fail-closed: no document was created, nothing is readable.
  assert.equal(await pathExists(store.pathFor('profile', '')), false)
  assert.equal(store.peek('profile', ''), undefined)
  const got = await store.get({ path: 'preferences_user' })
  assert.equal(got.count, 0)
})

test('G1.2 trustOf mapea las fuentes válidas y devuelve undefined ante un prefijo desconocido (fail-closed)', () => {
  assert.equal(trustOf('user:x'), 'user')
  assert.equal(trustOf('agent:turn-1'), 'host')
  assert.equal(trustOf('subagent:3'), 'host')
  assert.equal(trustOf('tool:webfetch'), 'untrusted')
  assert.equal(trustOf('plugin:x'), 'plugin-data')
  // Prefijos fuera del mapa no tienen tier: el store rechaza el write con
  // MEMORY_NO_TRUST en lugar de admitirlo por defecto.
  assert.equal(trustOf('system:x'), undefined)
  assert.equal(trustOf('bogus'), undefined)
  assert.equal(trustOf(undefined), undefined)
  assert.deepEqual([...MEMORY_TRUST], ['host', 'user', 'plugin-data', 'untrusted'])
})

test('G1.3 el patch del caller no puede auto-admitir: trust/state/promotedBy del value se ignoran', async () => {
  const store = await freshStore()
  const outcome = await store.set({
    path: 'preferences_user[+]',
    value: {
      text: 'dato de herramienta',
      state: 'admitted',
      trust: 'user',
      promotedBy: 'atacante',
      promotedAt: '2030-01-01T00:00:00.000Z'
    },
    source: 'tool:webfetch'
  })
  assert.equal(outcome.trust, 'untrusted')
  assert.equal(outcome.state, 'quarantined')
  const entry = quarantineEntry(store, outcome.id)
  assert.equal(entry.trust, 'untrusted')
  assert.equal(entry.state, 'quarantined')
  assert.equal(entry.promotedBy, undefined)
  assert.equal(entry.promotedAt, undefined)
})

/* ── G2: untrusted reviewer → 0 tools, 0 mutation, audit ────────────────── */

test('G2.0 reviewerCanPromote es membresía pura: solo host/user promueven', () => {
  assert.equal(reviewerCanPromote({ id: 'h', trust: 'host' }), true)
  assert.equal(reviewerCanPromote({ id: 'u', trust: 'user' }), true)
  assert.equal(reviewerCanPromote({ id: 'p', trust: 'plugin-data' }), false)
  assert.equal(reviewerCanPromote({ id: 't', trust: 'untrusted' }), false)
  assert.equal(reviewerCanPromote({ id: 'x', trust: 'superadmin' }), false)
  assert.equal(reviewerCanPromote(null), false)
  assert.equal(reviewerCanPromote({ id: '', trust: 'user' }), true) // el id vacío lo rechaza promote(), no la política de tier
})

test('G2.1 promote con reviewer plugin-data → REVIEWER_POLICY; la entrada sigue quarantined e invisible; deny auditado', async () => {
  const store = await freshStore()
  const written = await store.set({ path: 'preferences_user[+]', value: 'secreto de plugin', source: 'plugin:sk' })
  assert.equal(written.state, 'quarantined')
  await expectCode(
    store.promote({ path: `preferences_user.${written.id}`, reviewer: { id: 'plugin-x', trust: 'plugin-data' } }),
    'REVIEWER_POLICY'
  )
  // 0 mutación: la entrada sigue quarantined…
  const entry = quarantineEntry(store, written.id)
  assert.equal(entry.state, 'quarantined')
  assert.equal(isQuarantined(entry), true)
  // …e invisible para get()…
  const got = await store.get({ path: 'preferences_user' })
  assert.equal(got.count, 0)
  // …y el journal registra el deny con el reviewer.
  const lines = await journalLines(store)
  const deny = lines.find((line) => line.op === 'deny' && line.reason === 'REVIEWER_POLICY')
  assert.ok(deny, 'el journal contiene el deny')
  assert.equal(deny.reviewer.id, 'plugin-x')
  assert.equal(deny.reviewer.trust, 'plugin-data')
})

test('G2.2 promote con reviewer untrusted → REVIEWER_POLICY', async () => {
  const store = await freshStore()
  const written = await store.set({ path: 'preferences_user[+]', value: 'dato tool', source: 'tool:read' })
  await expectCode(
    store.promote({ path: `preferences_user.${written.id}`, reviewer: { id: 'm', trust: 'untrusted' } }),
    'REVIEWER_POLICY'
  )
  assert.equal(quarantineEntry(store, written.id).state, 'quarantined')
})

/* ── G3: quarantined legible con label; nunca como system/host ──────────── */

test('G3.1 quarantined excluido: get() no lo muestra y renderMemory no lo inyecta ni lo marca como system/host', async () => {
  const store = await freshStore()
  const admitted = await store.set({ path: 'preferences_user[+]', value: 'FRASE-ADMITIDA-UNICA', source: 'user' })
  const held = await store.set({ path: 'preferences_user[+]', value: 'FRASE-QUARANTINED-UNICA', source: 'tool:fetch' })
  assert.equal(admitted.state, 'admitted')
  assert.equal(held.state, 'quarantined') // legible con label en el outcome
  const got = await store.get({ path: 'preferences_user' })
  assert.equal(got.count, 1)
  assert.equal(got.facets[0].entries[0].text, 'FRASE-ADMITIDA-UNICA')
  const rendered = renderMemory({ documents: store.snapshot() })
  assert.ok(rendered.text.includes('FRASE-ADMITIDA-UNICA'), 'la entrada admitida sí se inyecta')
  assert.ok(!rendered.text.includes('FRASE-QUARANTINED-UNICA'), 'la entrada quarantined no se inyecta')
  assert.ok(!rendered.text.includes('quarantined'), 'sin marcador de quarantined en el prompt')
  assert.ok(!rendered.text.includes('untrusted'), 'sin marcador de untrusted en el prompt')
  assert.ok(!/\bsystem\b/i.test(rendered.text), 'nunca se presenta como system')
  assert.ok(!/\bhost\b/i.test(rendered.text), 'nunca se presenta como host')
})

test('G3.2 tras promote con reviewer user, get() y render SÍ muestran la entrada', async () => {
  const store = await freshStore()
  const held = await store.set({ path: 'preferences_user[+]', value: 'FRASE-PROMOVIDA-UNICA', source: 'tool:fetch' })
  const promoted = await store.promote({
    path: `preferences_user.${held.id}`,
    reviewer: { id: 'user-1', trust: 'user' }
  })
  assert.deepEqual(promoted, { ok: true, id: held.id, state: 'admitted' })
  const got = await store.get({ path: 'preferences_user' })
  assert.equal(got.count, 1)
  assert.equal(got.facets[0].entries[0].text, 'FRASE-PROMOVIDA-UNICA')
  const rendered = renderMemory({ documents: store.snapshot() })
  assert.ok(rendered.text.includes('FRASE-PROMOVIDA-UNICA'))
})

/* ── G4: promote solo HITL/política ─────────────────────────────────────── */

test('G4.1 sin promote la entrada permanece quarantined tras múltiples get()/snapshot()', async () => {
  const store = await freshStore()
  const held = await store.set({ path: 'preferences_user[+]', value: 'dato pendiente', source: 'plugin:p' })
  for (let i = 0; i < 3; i += 1) {
    await store.get({ path: 'preferences_user' })
    store.snapshot()
  }
  const entry = quarantineEntry(store, held.id)
  assert.equal(entry.state, 'quarantined')
  assert.equal(isQuarantined(entry), true)
})

test('G4.2 doble promote → STATE_POLICY la segunda vez; promote de entrada admitted → STATE_POLICY', async () => {
  const store = await freshStore()
  const reviewer = { id: 'host-1', trust: 'host' }
  const held = await store.set({ path: 'preferences_user[+]', value: 'dato q', source: 'tool:t' })
  const first = await store.promote({ path: `preferences_user.${held.id}`, reviewer })
  assert.equal(first.state, 'admitted')
  await expectCode(store.promote({ path: `preferences_user.${held.id}`, reviewer }), 'STATE_POLICY')
  const admitted = await store.set({ path: 'preferences_user[+]', value: 'dato user', source: 'user' })
  assert.equal(admitted.state, 'admitted')
  assert.equal(initialStateFor('user'), 'admitted')
  await expectCode(store.promote({ path: `preferences_user.${admitted.id}`, reviewer }), 'STATE_POLICY')
})

/* ── G5: compact sin cambios ────────────────────────────────────────────── */

test('G5.1 el preset compaction-basic conserva los ratios del owner: thresholdRatio 0.90, retainRatio 0.12', async () => {
  const preset = await readFile(resolve(THIS_DIR, '../../abaco-context/presets/abaco/agent.cordis.yml'), 'utf8')
  const row = preset.match(
    /-\s*id:\s*compaction-basic[\s\S]*?thresholdRatio:\s*([0-9.]+)[\s\S]*?retainRatio:\s*([0-9.]+)/
  )
  assert.ok(row, 'la fila compaction-basic con ambos ratios existe en el preset')
  assert.equal(Number(row[1]), 0.9)
  assert.equal(Number(row[2]), 0.12)
})

test('G5.2 git diff no toca abaco-context ni la configuración de compactación', () => {
  const out = execFileSync('git', ['-C', THIS_DIR, 'diff', '--name-only'], { encoding: 'utf8' })
  const changed = out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  for (const file of changed) {
    assert.ok(!file.includes('abaco-context'), `el diff no debe tocar abaco-context: ${file}`)
    assert.ok(
      !/compaction|preset-installer|agent\.cordis\.yml/i.test(file),
      `el diff no debe tocar la compactación: ${file}`
    )
  }
})

/* ── G6: suite fail-closed + audit + contador ───────────────────────────── */

test('G6.1 journal fail-closed: 1 quarantine + 1 deny + 1 promote tras una secuencia conocida', async () => {
  const store = await freshStore()
  const held = await store.set({ path: 'preferences_user[+]', value: 'dato q6', source: 'tool:t' })
  await assert.rejects(
    store.set({ path: 'preferences_user[+]', value: 'x', source: 'agent:t', trust: 'nope' }),
    (err) => err.code === 'MEMORY_NO_TRUST'
  )
  await store.promote({ path: `preferences_user.${held.id}`, reviewer: { id: 'u', trust: 'user' } })
  const lines = await journalLines(store)
  assert.equal(countOp(lines, 'quarantine'), 1)
  assert.equal(countOp(lines, 'deny'), 1)
  assert.equal(countOp(lines, 'promote'), 1)
  assert.equal(countOp(lines, 'set'), 1, 'el write denegado nunca escribió op set')
})

test('G6.2 un write denegado no deja documento a medio escribir', async () => {
  const store = await freshStore()
  await expectCode(
    store.set({ path: 'preferences_user[+]', value: 'x', source: 'agent:t', trust: 'bogus' }),
    'MEMORY_NO_TRUST'
  )
  assert.equal(await pathExists(store.pathFor('profile', '')), false)
  assert.equal(store.peek('profile', ''), undefined)
  const got = await store.get()
  assert.equal(got.count, 0)
})

/* ── G7: naming Janice/Atena correcto ───────────────────────────────────── */

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

test('G7 naming: Atena nunca está en el path de autorización; Janice nunca decide en el código', async () => {
  for (const file of ['quarantine.js', 'store.js', 'tools.js', 'render.js']) {
    const source = await readFile(join(PKG_DIR, 'lib', file), 'utf8')
    assert.ok(!/\bAtena\b/.test(source), `${file}: 'Atena' no aparece en el path de autorización`)
    // Si 'Janice' apareciera, solo puede ser en comentarios (runtime/asesor);
    // en el código ejecutable — donde vive la decisión de promote — no.
    const code = stripComments(source)
    assert.ok(!/\bJanice\b/i.test(code), `${file}: 'Janice' no decide nada en el código`)
  }
})

/* ── Q1: threat-model cableado al store real ─────────────────────────────── */

test('Q1 el store usa el módulo de quarantine real, no una copia aislada', async () => {
  const source = await readFile(join(PKG_DIR, 'lib', 'store.js'), 'utf8')
  assert.ok(source.includes('./quarantine.js'), 'store.js importa lib/quarantine.js')
  assert.ok(/\btrustOf\b/.test(source), 'store.js usa trustOf')
  assert.ok(/\binitialStateFor\b/.test(source), 'store.js usa initialStateFor')
  assert.ok(/\breviewerCanPromote\b/.test(source), 'store.js usa reviewerCanPromote')
  assert.ok(/\bisQuarantined\b/.test(source), 'store.js usa isQuarantined')
})

/* ── Q2: facts inbound nacen quarantined; user/agent nacen admitted ──────── */

test('Q2.1 facts inbound (tool:*, plugin:*) nacen quarantined', async () => {
  const store = await freshStore()
  const fromTool = await store.set({ path: 'preferences_user[+]', value: 'dato inbound A', source: 'tool:webfetch' })
  const fromPlugin = await store.set({ path: 'preferences_user[+]', value: 'dato inbound B', source: 'plugin:x' })
  assert.equal(fromTool.trust, 'untrusted')
  assert.equal(fromTool.state, 'quarantined')
  assert.equal(fromPlugin.trust, 'plugin-data')
  assert.equal(fromPlugin.state, 'quarantined')
})

test('Q2.2 user y agent nacen admitted', async () => {
  const store = await freshStore()
  const fromUser = await store.set({ path: 'preferences_user[+]', value: 'dato user', source: 'user' })
  const fromAgent = await store.set({ path: 'preferences_user[+]', value: 'dato agent', source: 'agent:turn-1' })
  assert.equal(fromUser.trust, 'user')
  assert.equal(fromUser.state, 'admitted')
  assert.equal(fromAgent.trust, 'host')
  assert.equal(fromAgent.state, 'admitted')
})
