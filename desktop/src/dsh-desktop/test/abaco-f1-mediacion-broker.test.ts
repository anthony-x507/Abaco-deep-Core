import { describe, expect, it, beforeEach } from 'vitest'
import {
  authorize,
  resetBrokerForTests,
  getBrokerStats,
  getAuditLog,
  issueTaskGrant,
  revokeGrant,
  resolveIdentity,
  unloadAdmittedPlugin,
  isSessionUnloaded,
  proposeContractEvolution,
  acceptContractEvolution,
  getSessionCapsForTests,
  DISABLED_PLUGINS,
  PATCH_ENABLED,
  MANIFEST_CAPS,
  hashArgs,
  SEALED_PRELOAD_KEYS,
  proposeAdmissionChange,
  getAdmissionGraph,
  parsePatchInsertIds,
} from '../packages/abaco-effect-broker/index.js'
import { apply as applyVoice, LOCAL_TRANSCRIBE_PATH, LOCAL_STATUS_PATH, __dangerLegacySpawnProbe } from '../packages/abaco-voice/index.js'
import { executeAuthorized, getCellStats, resetCellStatsForTests } from '../packages/abaco-mediacion-pilot/index.js'
import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const CONTRACT = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../../../docs/contracts/f1-broker-deny-reasons.json'),
    'utf8',
  ),
)

function assertDenyFour(decision: { decision: string; reason?: string; audit?: any }, denyBefore: number, allowBefore: number) {
  expect(decision.decision).toBe('deny')
  const audits = getAuditLog()
  const last = decision.audit || audits[audits.length - 1]
  expect(last).toBeTruthy()
  expect(last.decision).toBe('deny')
  expect(last.side_effect).toBe(false)
  expect(last.reason).toBeTruthy()
  const stats = getBrokerStats()
  expect(stats.denyCount).toBe(denyBefore + 1)
  expect(stats.allowCount).toBe(allowBefore)
  expect(CONTRACT.deny_reasons).toContain(last.reason)
}

describe('F1 broker fail-closed (M1–M10 + mediation closeout)', () => {
  beforeEach(() => {
    resetBrokerForTests()
    resetCellStatsForTests()
  })

  it('M1: no channel identity → deny, 0 side-effect, audit, counter', () => {
    const denyBefore = getBrokerStats().denyCount
    const allowBefore = getBrokerStats().allowCount
    const d = authorize({
      channel: null as any,
      task_id: null,
      effect: { kind: 'proc.spawn', resource: 'bin:mlx_whisper', args_hash: 'x' },
      trust_in: 'user',
    })
    assertDenyFour(d, denyBefore, allowBefore)
    expect(d.reason).toBe('no-identity')
  })

  it('M2: disabled plugin → deny plugin-disabled', () => {
    expect(DISABLED_PLUGINS.has('abaco-brand')).toBe(true)
    const denyBefore = getBrokerStats().denyCount
    const allowBefore = getBrokerStats().allowCount
    const d = authorize({
      channel: { kind: 'cordis.host', pluginId: 'abaco-brand' },
      task_id: null,
      effect: { kind: 'host.fetch', resource: '/x', args_hash: 'x' },
      trust_in: 'user',
    })
    assertDenyFour(d, denyBefore, allowBefore)
    expect(d.reason).toBe('plugin-disabled')
  })

  it('M3: inject-undeclared + CI grep window.__abaco_ctx =', async () => {
    const source = await readFile('packages/abaco-voice/client.js', 'utf8')
    expect(source).not.toMatch(/window\.__abaco_ctx\s*=/)
    const voiceHost = await readFile('packages/abaco-voice/index.js', 'utf8')
    expect(voiceHost).not.toMatch(/window\.__abaco_ctx\s*=/)
    const denyBefore = getBrokerStats().denyCount
    const allowBefore = getBrokerStats().allowCount
    const d = authorize({
      channel: { kind: 'cordis.host', pluginId: 'abaco-voice', inject: ['__abaco_ctx'] },
      task_id: null,
      effect: { kind: 'host.fetch', resource: LOCAL_STATUS_PATH, args_hash: 'x' },
      trust_in: 'user',
    })
    assertDenyFour(d, denyBefore, allowBefore)
    expect(d.reason).toBe('inject-undeclared')
    expect(d.audit.a_plugin_ok).toBe(false)
  })

  it('M4: preload key outside sealed allowlist → preload-not-allowlisted', () => {
    expect(SEALED_PRELOAD_KEYS).not.toContain('evil-new-channel')
    const denyBefore = getBrokerStats().denyCount
    const allowBefore = getBrokerStats().allowCount
    const d = authorize({
      channel: { kind: 'preload', preloadKey: 'evil-new-channel', pluginId: 'abaco-voice' },
      task_id: null,
      effect: { kind: 'ipc.invoke', resource: 'evil-new-channel', args_hash: 'x' },
      trust_in: 'user',
    })
    assertDenyFour(d, denyBefore, allowBefore)
    expect(d.reason).toBe('preload-not-allowlisted')
  })

  it('M5: skill/tool.register from plugin-data → deny; #tools invariant', () => {
    const tools = new Set(['abaco_existing'])
    const before = tools.size
    const denyBefore = getBrokerStats().denyCount
    const allowBefore = getBrokerStats().allowCount
    const d = authorize({
      channel: { kind: 'host.fetch', path: LOCAL_TRANSCRIBE_PATH },
      task_id: null,
      effect: { kind: 'tool.register', resource: 'evil_tool', args_hash: 'x' },
      trust_in: 'plugin-data',
    })
    assertDenyFour(d, denyBefore, allowBefore)
    expect(d.reason).toBe('skill-cannot-register-tool')
    expect(tools.size).toBe(before)
  })

  it('M6: untrusted → spawn / write / hop = data-as-control', () => {
    for (const effect of [
      { kind: 'proc.spawn' as const, resource: 'bin:mlx_whisper' },
      { kind: 'fs.write' as const, resource: 'fs:tmpdir' },
      { kind: 'ipc.invoke' as const, resource: 'hop:send_to_agent' },
    ]) {
      resetBrokerForTests()
      const denyBefore = getBrokerStats().denyCount
      const allowBefore = getBrokerStats().allowCount
      const d = authorize({
        channel: { kind: 'host.fetch', path: LOCAL_TRANSCRIBE_PATH },
        task_id: null,
        effect: { ...effect, args_hash: 'x' },
        trust_in: 'untrusted',
      })
      assertDenyFour(d, denyBefore, allowBefore)
      expect(d.reason).toBe('data-as-control')
    }
  })

  it('M7: revoked grant → deny ≤1s; ttl-expired', () => {
    const g = issueTaskGrant({
      pluginId: 'abaco-voice',
      effects: ['proc.spawn', 'host.fetch', 'fs.write', 'fs.read'],
      resources: ['bin:mlx_whisper', 'bin:ffmpeg', '/api/abaco-voice.local-transcribe', 'fs:tmpdir'],
    })
    const t0 = Date.now()
    revokeGrant(g.grant_id)
    const denyBefore = getBrokerStats().denyCount
    const allowBefore = getBrokerStats().allowCount
    const d = authorize({
      channel: { kind: 'host.fetch', path: LOCAL_TRANSCRIBE_PATH },
      task_id: g.task_id,
      grant_id: g.grant_id,
      effect: { kind: 'proc.spawn', resource: 'bin:mlx_whisper', args_hash: 'x' },
      trust_in: 'user',
    })
    assertDenyFour(d, denyBefore, allowBefore)
    expect(d.reason).toBe('grant-revoked')
    expect(Date.now() - t0).toBeLessThan(1000)

    const expired = issueTaskGrant({
      pluginId: 'abaco-voice',
      effects: ['host.fetch'],
      resources: [LOCAL_STATUS_PATH],
      ttlMs: 1,
    })
    expired.issued_at = Date.now() - 50
    const denyBeforeTtl = getBrokerStats().denyCount
    const allowBeforeTtl = getBrokerStats().allowCount
    const ttl = authorize({
      channel: { kind: 'host.fetch', path: LOCAL_STATUS_PATH },
      task_id: expired.task_id,
      grant_id: expired.grant_id,
      effect: { kind: 'host.fetch', resource: LOCAL_STATUS_PATH, args_hash: 'x' },
      trust_in: 'user',
    })
    assertDenyFour(ttl, denyBeforeTtl, allowBeforeTtl)
    expect(ttl.reason).toBe('ttl-expired')
  })

  it('M8: forged body plugin_id ignored — identity from channel path', () => {
    const id = resolveIdentity({
      kind: 'host.fetch',
      path: LOCAL_TRANSCRIBE_PATH,
      pluginId: 'abaco-brand',
    })
    expect(id).toBe('abaco-voice')
  })

  it('M9: compose.mutate / widen-caps without HITL → compose-mutate-forbidden', () => {
    const denyBefore = getBrokerStats().denyCount
    const allowBefore = getBrokerStats().allowCount
    const d = authorize({
      channel: { kind: 'cordis.host', pluginId: 'abaco-voice' },
      task_id: null,
      effect: { kind: 'compose.mutate', resource: 'caps:abaco-voice', args_hash: 'x' },
      trust_in: 'user',
    })
    assertDenyFour(d, denyBefore, allowBefore)
    expect(d.reason).toBe('compose-mutate-forbidden')

    const graph = getAdmissionGraph()
    const proposed = proposeAdmissionChange(graph, {
      source: 'host',
      action: 'widen-caps',
      pluginId: 'abaco-voice',
    })
    expect(proposed.decision).toBe('deny')
    expect(proposed.side_effect).toBe(false)
    expect(proposed.wrote_patch_yml).toBe(false)
  })

  it('M10: broker throw → deny policy (fail-closed, never allow)', () => {
    const denyBefore = getBrokerStats().denyCount
    const allowBefore = getBrokerStats().allowCount
    const d = authorize({
      channel: {
        get kind() {
          throw new Error('forced broker throw')
        },
      } as any,
      task_id: null,
      effect: { kind: 'host.fetch', resource: LOCAL_STATUS_PATH, args_hash: 'x' },
      trust_in: 'user',
    })
    assertDenyFour(d, denyBefore, allowBefore)
    expect(d.reason).toBe('policy')
    expect(d.decision).not.toBe('allow')
  })

  it('M-happy: broker allow path for voice status (identity + grant)', () => {
    const d = authorize({
      channel: { kind: 'host.fetch', path: LOCAL_STATUS_PATH },
      task_id: null,
      effect: {
        kind: 'host.fetch',
        resource: LOCAL_STATUS_PATH,
        args_hash: hashArgs({ method: 'GET' }),
      },
      trust_in: 'user',
    })
    expect(d.decision).toBe('allow')
    if (d.decision === 'allow') {
      expect(d.grant.plugin_id).toBe('abaco-voice')
      expect(d.grant.grant_id).toBeTruthy()
    }
    expect(getBrokerStats().allowCount).toBe(1)
  })

  it('architect-9: min inject + own ui.slot allows without Cloud Agent', () => {
    const d = authorize({
      channel: { kind: 'cordis.host', pluginId: 'abaco-voice', inject: ['connection'] },
      task_id: null,
      effect: { kind: 'ui.slot', resource: 'abaco-voice', args_hash: hashArgs({ slot: 'voice' }) },
      trust_in: 'user',
    })
    expect(d.decision).toBe('allow')
    if (d.decision === 'allow') {
      expect(d.grant.plugin_id).toBe('abaco-voice')
      expect(d.grant.effects).toContain('ui.slot')
    }
  })

  it('budget-exceeded counts as deny with 0 side-effect', () => {
    const g = issueTaskGrant({
      pluginId: 'abaco-voice',
      effects: ['host.fetch'],
      resources: [LOCAL_STATUS_PATH],
      budget: { calls: 0, bytes: 1024 },
    })
    const denyBefore = getBrokerStats().denyCount
    const allowBefore = getBrokerStats().allowCount
    const d = authorize({
      channel: { kind: 'host.fetch', path: LOCAL_STATUS_PATH },
      task_id: g.task_id,
      grant_id: g.grant_id,
      effect: { kind: 'host.fetch', resource: LOCAL_STATUS_PATH, args_hash: 'x' },
      trust_in: 'user',
    })
    assertDenyFour(d, denyBefore, allowBefore)
    expect(d.reason).toBe('budget-exceeded')
  })

  it('voice host has zero spawn( — direct spawn is LEGACY_UNMEDIATED', async () => {
    const source = await readFile('packages/abaco-voice/index.js', 'utf8')
    expect(source).not.toMatch(/\bspawn\s*\(/)
    expect(source).toContain('authorize(')
    expect(source).toContain('executeAuthorized')
    expect(__dangerLegacySpawnProbe()).toBe('LEGACY_UNMEDIATED')
    expect(getBrokerStats().effectsWithoutGrant).toBe(1)
  })

  it('pilot is executor not grantor — no broker.grant in pilot', async () => {
    const pilot = await readFile('packages/abaco-mediacion-pilot/index.js', 'utf8')
    const worker = await readFile('packages/abaco-mediacion-pilot/worker.js', 'utf8')
    expect(pilot).not.toMatch(/issueTaskGrant|broker\.grant/)
    const workerCode = worker.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n')
    expect(workerCode).not.toMatch(/\bauthorize\s*\(|issueTaskGrant/)
    expect(worker).toContain('grantId')
  })

  it('authorize() body has zero Atena', async () => {
    const src = await readFile('packages/abaco-effect-broker/index.js', 'utf8')
    const authorizeFn = src.slice(src.indexOf('export function authorize'))
    expect(authorizeFn).not.toMatch(/\bAtena\b/)
  })

  it('registers voice routes and status is mediated', async () => {
    const registry: Array<{ path: string; methods: string[]; fetch: (req: Request) => Promise<Response> }> = []
    applyVoice({
      connection: {
        fetch: {
          register: (entry: (typeof registry)[number]) => { registry.push(entry) },
        },
      },
    } as never)
    expect(registry.map((r) => r.path).sort()).toEqual([LOCAL_STATUS_PATH, LOCAL_TRANSCRIBE_PATH].sort())
    const status = registry.find((r) => r.path === LOCAL_STATUS_PATH)!
    const res = await status.fetch(new Request(`http://abaco.local${LOCAL_STATUS_PATH}`))
    expect(res.status).toBe(200)
    const body = await res.json() as { mediated?: boolean; ok: boolean }
    expect(body.ok).toBe(true)
    expect(body.mediated).toBe(true)
  })

  it('recorrido: transcribe fetch+spawn+ffmpeg must authorize before executor', () => {
    const fetchD = authorize({
      channel: { kind: 'host.fetch', path: LOCAL_TRANSCRIBE_PATH },
      task_id: null,
      effect: {
        kind: 'host.fetch',
        resource: LOCAL_TRANSCRIBE_PATH,
        args_hash: hashArgs({ filename: 'a.webm', model: 'small-mlx', language: 'es', n: 8 }),
      },
      trust_in: 'user',
    })
    expect(fetchD.decision).toBe('allow')
    if (fetchD.decision !== 'allow') return
    const spawnD = authorize({
      channel: { kind: 'host.fetch', path: LOCAL_TRANSCRIBE_PATH },
      task_id: fetchD.grant.task_id,
      grant_id: fetchD.grant.grant_id,
      effect: { kind: 'proc.spawn', resource: 'bin:mlx_whisper', args_hash: hashArgs({ model: 'small-mlx' }) },
      trust_in: 'user',
    })
    expect(spawnD.decision).toBe('allow')
    const ffmpegD = authorize({
      channel: { kind: 'host.fetch', path: LOCAL_TRANSCRIBE_PATH },
      task_id: fetchD.grant.task_id,
      grant_id: fetchD.grant.grant_id,
      effect: { kind: 'proc.spawn', resource: 'bin:ffmpeg', args_hash: hashArgs({ convert: true }) },
      trust_in: 'user',
    })
    expect(ffmpegD.decision).toBe('allow')
    expect(getBrokerStats().allowCount).toBe(3)
  })

  it('pilot removable this session — no restart, no patch.yml write, no spawn', async () => {
    const g = issueTaskGrant({
      pluginId: 'abaco-mediacion-pilot',
      effects: ['proc.spawn', 'fs.read', 'fs.write'],
      resources: ['bin:mlx_whisper', 'bin:ffmpeg', 'fs:tmpdir'],
    })
    const unloaded = unloadAdmittedPlugin('abaco-mediacion-pilot')
    expect(unloaded.decision).toBe('ok')
    expect(unloaded.side_effect).toBe(false)
    expect(unloaded.wrote_patch_yml).toBe(false)
    expect(unloaded.wrote_dsh_desktop).toBe(false)
    expect(isSessionUnloaded('abaco-mediacion-pilot')).toBe(true)

    const launchedBefore = getCellStats().launched
    await expect(executeAuthorized({ grantId: g.grant_id, op: 'status', args: {} })).rejects.toThrow(/unauthorized/)
    expect(getCellStats().launched).toBe(launchedBefore)

    const denyBefore = getBrokerStats().denyCount
    const allowBefore = getBrokerStats().allowCount
    const d = authorize({
      channel: { kind: 'cordis.host', pluginId: 'abaco-mediacion-pilot' },
      task_id: null,
      effect: { kind: 'proc.spawn', resource: 'bin:ffmpeg', args_hash: 'x' },
      trust_in: 'user',
    })
    assertDenyFour(d, denyBefore, allowBefore)
    expect(d.reason).toBe('plugin-disabled')
    expect(() => issueTaskGrant({ pluginId: 'abaco-mediacion-pilot', effects: ['proc.spawn'], resources: ['bin:ffmpeg'] })).toThrow(/A_plugin/)
  })

  it('A_plugin admitted ids are a subset of live patch.yml insert rows', async () => {
    const patch = await readFile('build/dsh-desktop.patch.yml', 'utf8')
    const rows = new Set(parsePatchInsertIds(patch))
    for (const id of Object.keys(MANIFEST_CAPS)) {
      expect(PATCH_ENABLED.has(id)).toBe(true)
      expect(rows.has(id)).toBe(true)
      expect(DISABLED_PLUGINS.has(id)).toBe(false)
    }
    const graph = getAdmissionGraph()
    expect([...graph.admitted].sort()).toEqual(['abaco-mediacion-pilot', 'abaco-voice'])
  })

  it('doctrine: HITL ContractEvolution widens admitted plugin without pin write', () => {
    const denyBefore = getBrokerStats().denyCount
    const allowBefore = getBrokerStats().allowCount
    const blocked = authorize({
      channel: { kind: 'cordis.host', pluginId: 'abaco-brand' },
      task_id: null,
      effect: { kind: 'host.fetch', resource: '/x', args_hash: 'x' },
      trust_in: 'user',
    })
    assertDenyFour(blocked, denyBefore, allowBefore)
    expect(blocked.reason).toBe('plugin-disabled')
    resetBrokerForTests()

    const proposed = proposeContractEvolution({
      pluginId: 'abaco-voice',
      effects: ['host.fetch'],
      resources: ['/api/abaco-voice.local-extra'],
    })
    expect(proposed.decision).toBe('proposed')
    expect(proposed.widen).toBe(true)
    expect(acceptContractEvolution({ proposal_id: proposed.proposal_id }).decision).toBe('deny')
    // INV-NO-WIDEN: HITL alone cannot widen beyond pin — need pinRevision.
    const hitlOnly = acceptContractEvolution({ proposal_id: proposed.proposal_id, hitl: true })
    expect(hitlOnly.decision).toBe('deny')
    expect(hitlOnly.reason).toBe('caps-widen-requires-pin-revision')
    const accepted = acceptContractEvolution({
      proposal_id: proposed.proposal_id,
      hitl: true,
      pinRevision: true,
    })
    expect(accepted.decision).toBe('ok')
    expect(accepted.pin_revision).toBe(true)
    expect(accepted.wrote_patch_yml).toBe(false)
    expect(MANIFEST_CAPS['abaco-voice'].resources).not.toContain('/api/abaco-voice.local-extra')
    expect(getSessionCapsForTests('abaco-voice').resources).toContain('/api/abaco-voice.local-extra')

    const d = authorize({
      channel: { kind: 'host.fetch', path: LOCAL_STATUS_PATH, pluginId: 'abaco-voice' },
      task_id: null,
      effect: {
        kind: 'host.fetch',
        resource: '/api/abaco-voice.local-extra',
        args_hash: hashArgs({ method: 'GET' }),
      },
      trust_in: 'user',
    })
    expect(d.decision).toBe('allow')
  })

  it('mutation: a swallowed deny cannot keep allowCount moving', () => {
    const allowBefore = getBrokerStats().allowCount
    const d = authorize({
      channel: null as any,
      task_id: null,
      effect: { kind: 'net.fetch', resource: 'https://evil.example', args_hash: 'x' },
      trust_in: 'untrusted',
    })
    expect(d.decision).toBe('deny')
    expect(getBrokerStats().allowCount).toBe(allowBefore)
  })
})

describe('F1 patch.yml locks', () => {
  it('adds mediacion-pilot and does not rehab disabled plugins', async () => {
    const patch = await readFile('build/dsh-desktop.patch.yml', 'utf8')
    expect(patch).toContain('id: abaco-mediacion-pilot')
    expect(patch).toMatch(/TEMPORARILY DISABLED/)
    const afterNote = patch.split('TEMPORARILY DISABLED')[1] || ''
    expect(afterNote).not.toMatch(/- insert:\s*\n\s*- id: abaco-brand/)
  })
})
