import { describe, expect, it, beforeEach } from 'vitest'
import {
  authorize,
  resetBrokerForTests,
  getBrokerStats,
  getAuditLog,
  issueTaskGrant,
  revokeGrant,
  resolveIdentity,
  DISABLED_PLUGINS,
  hashArgs,
} from '../packages/abaco-effect-broker/index.js'
import { apply as applyVoice, LOCAL_TRANSCRIBE_PATH, LOCAL_STATUS_PATH, __dangerLegacySpawnProbe } from '../packages/abaco-voice/index.js'
import { readFile } from 'node:fs/promises'

function assertDenyFour(decision: { decision: string; reason?: string; audit?: any }) {
  expect(decision.decision).toBe('deny')
  const audits = getAuditLog()
  const last = decision.audit || audits[audits.length - 1]
  expect(last.decision).toBe('deny')
  expect(last.side_effect).toBe(false)
  expect(last.reason).toBeTruthy()
  const stats = getBrokerStats()
  expect(stats.denyCount).toBeGreaterThan(0)
}

describe('F1 broker fail-closed (M1–M10 subset + mediation)', () => {
  beforeEach(() => {
    resetBrokerForTests()
  })

  it('M1: no channel identity → deny, 0 side-effect, audit', () => {
    const d = authorize({
      channel: null as any,
      task_id: null,
      effect: { kind: 'proc.spawn', resource: 'bin:mlx_whisper', args_hash: 'x' },
      trust_in: 'user',
    })
    assertDenyFour(d)
    expect(d.reason).toBe('no-identity')
  })

  it('M2: disabled plugin → deny plugin-disabled', () => {
    expect(DISABLED_PLUGINS.has('abaco-brand')).toBe(true)
    const d = authorize({
      channel: { kind: 'cordis.host', pluginId: 'abaco-brand' },
      task_id: null,
      effect: { kind: 'host.fetch', resource: '/x', args_hash: 'x' },
      trust_in: 'user',
    })
    assertDenyFour(d)
    expect(d.reason).toBe('plugin-disabled')
  })

  it('M3: voice source never assigns window.__abaco_ctx = ctx', async () => {
    const source = await readFile('packages/abaco-voice/client.js', 'utf8')
    expect(source).not.toMatch(/window\.__abaco_ctx\s*=\s*ctx/)
  })

  it('M6: untrusted → proc.spawn = data-as-control', () => {
    const d = authorize({
      channel: { kind: 'host.fetch', path: LOCAL_TRANSCRIBE_PATH },
      task_id: null,
      effect: { kind: 'proc.spawn', resource: 'bin:mlx_whisper', args_hash: 'x' },
      trust_in: 'untrusted',
    })
    assertDenyFour(d)
    expect(d.reason).toBe('data-as-control')
  })

  it('M7: revoked grant → deny', () => {
    const g = issueTaskGrant({
      pluginId: 'abaco-voice',
      effects: ['proc.spawn', 'host.fetch', 'fs.write', 'fs.read'],
      resources: ['bin:mlx_whisper', 'bin:ffmpeg', '/api/abaco-voice.local-transcribe', 'fs:tmpdir'],
    })
    revokeGrant(g.grant_id)
    const d = authorize({
      channel: { kind: 'host.fetch', path: LOCAL_TRANSCRIBE_PATH },
      task_id: g.task_id,
      grant_id: g.grant_id,
      effect: { kind: 'proc.spawn', resource: 'bin:mlx_whisper', args_hash: 'x' },
      trust_in: 'user',
    })
    assertDenyFour(d)
    expect(d.reason).toBe('grant-revoked')
  })

  it('M8: forged body plugin_id ignored — identity from channel path', () => {
    const id = resolveIdentity({
      kind: 'host.fetch',
      path: LOCAL_TRANSCRIBE_PATH,
      pluginId: 'abaco-brand', // forged
    })
    expect(id).toBe('abaco-voice')
  })

  it('M5: skill/tool.register from plugin-data → deny', () => {
    const d = authorize({
      channel: { kind: 'host.fetch', path: LOCAL_TRANSCRIBE_PATH },
      task_id: null,
      effect: { kind: 'tool.register', resource: 'evil_tool', args_hash: 'x' },
      trust_in: 'plugin-data',
    })
    assertDenyFour(d)
    expect(d.reason).toBe('skill-cannot-register-tool')
  })

  it('M10: broker allow path for voice status (happy)', () => {
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
})

describe('F1 patch.yml locks', () => {
  it('adds mediacion-pilot and does not rehab disabled plugins', async () => {
    const patch = await readFile('build/dsh-desktop.patch.yml', 'utf8')
    expect(patch).toContain('id: abaco-mediacion-pilot')
    expect(patch).toMatch(/TEMPORARILY DISABLED/)
    // disabled plugins must not appear as active -insert rows with those ids enabled
    // (they may appear in comments). Ensure insert blocks for brand are absent as live inserts after DISABLED note.
    const afterNote = patch.split('TEMPORARILY DISABLED')[1] || ''
    expect(afterNote).not.toMatch(/- insert:\s*\n\s*- id: abaco-brand/)
  })
})
