import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, beforeEach } from 'vitest'
import {
  authorize,
  resetBrokerForTests,
  getBrokerStats,
  getAuditLog,
  issueTaskGrant,
  revokeGrant,
  inspectGrant,
  DISABLED_PLUGINS,
  ADMISSION_ROLES,
  hashArgs,
} from '../packages/abaco-effect-broker/index.js'
import { apply as applyVoice, LOCAL_TRANSCRIBE_PATH, LOCAL_STATUS_PATH } from '../packages/abaco-voice/index.js'
import { apply as applyPilot, CELL_KIND } from '../packages/abaco-mediacion-pilot/index.js'

const DESK = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const STATUS_PATH = LOCAL_STATUS_PATH

function assertDenyFour(decision: { decision: string; reason?: string; audit?: { decision: string; side_effect: boolean; reason: string } }) {
  expect(decision.decision).toBe('deny')
  const last = decision.audit || getAuditLog()[getAuditLog().length - 1]
  expect(last.decision).toBe('deny')
  expect(last.side_effect).toBe(false)
  expect(last.reason).toBeTruthy()
  expect(getBrokerStats().denyCount).toBeGreaterThan(0)
}

describe('F1 day-14 recorrido TS (Janice / desktop)', () => {
  beforeEach(() => {
    resetBrokerForTests()
  })

  it('D14-1 mediación: unauthorized effects stay deny with 0 side-effect + audit + counter', () => {
    const cases: Array<{ label: string; req: Parameters<typeof authorize>[0]; reason: string }> = [
      {
        label: 'no identity',
        req: {
          channel: null as never,
          task_id: null,
          effect: { kind: 'proc.spawn', resource: 'bin:mlx_whisper', args_hash: 'x' },
          trust_in: 'user',
        },
        reason: 'no-identity',
      },
      {
        label: 'disabled plugin',
        req: {
          channel: { kind: 'cordis.host', pluginId: 'abaco-brand' },
          task_id: null,
          effect: { kind: 'host.fetch', resource: '/x', args_hash: 'x' },
          trust_in: 'user',
        },
        reason: 'plugin-disabled',
      },
      {
        label: 'data-as-control spawn',
        req: {
          channel: { kind: 'host.fetch', path: LOCAL_TRANSCRIBE_PATH },
          task_id: null,
          effect: { kind: 'proc.spawn', resource: 'bin:mlx_whisper', args_hash: 'x' },
          trust_in: 'untrusted',
        },
        reason: 'data-as-control',
      },
      {
        label: 'skill cannot register tool',
        req: {
          channel: { kind: 'host.fetch', path: LOCAL_TRANSCRIBE_PATH },
          task_id: null,
          effect: { kind: 'tool.register', resource: 'evil_tool', args_hash: 'x' },
          trust_in: 'plugin-data',
        },
        reason: 'skill-cannot-register-tool',
      },
    ]
    for (const c of cases) {
      resetBrokerForTests()
      const d = authorize(c.req)
      assertDenyFour(d)
      expect(d.reason, c.label).toBe(c.reason)
    }
  })

  it('D14-2 revoke ≤1s then voice status happy path still allows (host intact)', () => {
    const g = issueTaskGrant({
      pluginId: 'abaco-voice',
      effects: ['proc.spawn', 'host.fetch', 'fs.write', 'fs.read'],
      resources: ['bin:mlx_whisper', 'bin:ffmpeg', LOCAL_TRANSCRIBE_PATH, STATUS_PATH, 'fs:tmpdir'],
    })
    const t0 = Date.now()
    revokeGrant(g.grant_id)
    const denied = authorize({
      channel: { kind: 'host.fetch', path: LOCAL_TRANSCRIBE_PATH },
      task_id: g.task_id,
      grant_id: g.grant_id,
      effect: { kind: 'proc.spawn', resource: 'bin:mlx_whisper', args_hash: 'x' },
      trust_in: 'user',
    })
    expect(Date.now() - t0).toBeLessThanOrEqual(1000)
    assertDenyFour(denied)
    expect(denied.reason).toBe('grant-revoked')
    expect(inspectGrant(g.grant_id).live).toBe(false)

    const happy = authorize({
      channel: { kind: 'host.fetch', path: STATUS_PATH },
      task_id: null,
      effect: {
        kind: 'host.fetch',
        resource: STATUS_PATH,
        args_hash: hashArgs({ method: 'GET' }),
      },
      trust_in: 'user',
    })
    expect(happy.decision).toBe('allow')
  })

  it('D14-3 Janice=runtime, Atena≠authorize, no rehab, compact 0.90/0.12', async () => {
    expect(ADMISSION_ROLES.janice).toBe('runtime')
    expect(ADMISSION_ROLES.atena).toBe('advisor-never-grants')
    expect(CELL_KIND).toBe('strangler-fork')
    for (const id of ['abaco-brand', 'abaco-device-identity', 'abaco-cloud-sync', 'abaco-onboarding', 'abaco-experimental']) {
      expect(DISABLED_PLUGINS.has(id)).toBe(true)
    }

    const broker = await readFile(join(DESK, 'packages/abaco-effect-broker/index.js'), 'utf8')
    const authorizeFn = broker.slice(broker.indexOf('export function authorize'))
    expect(authorizeFn).not.toMatch(/\bAtena\b/)

    const preset = await readFile(join(DESK, 'packages/abaco-context/presets/abaco/agent.cordis.yml'), 'utf8')
    const row = preset.match(
      /-\s*id:\s*compaction-basic[\s\S]*?thresholdRatio:\s*([0-9.]+)[\s\S]*?retainRatio:\s*([0-9.]+)[\s\S]*?maxTokens:\s*([0-9]+)/,
    )
    expect(row).toBeTruthy()
    expect(Number(row![1])).toBe(0.9)
    expect(Number(row![2])).toBe(0.12)
    expect(Number(row![3])).toBe(8192)
  })

  it('D14-4 face mínima: piloto apply no añade rutas; voice sigue siendo el dueño', () => {
    const pilotRegistry: Array<{ path: string }> = []
    applyPilot({
      connection: { fetch: { register: (entry: { path: string }) => { pilotRegistry.push(entry) } } },
      tools: { register: () => {} },
    })
    expect(pilotRegistry).toEqual([])
    expect(existsSync(join(DESK, 'packages/abaco-mediacion-pilot/client.js'))).toBe(false)

    const voiceRegistry: Array<{ path: string }> = []
    applyVoice({
      connection: {
        fetch: {
          register: (entry: { path: string }) => { voiceRegistry.push(entry) },
        },
      },
    } as never)
    expect(voiceRegistry.map((r) => r.path).sort()).toEqual([LOCAL_STATUS_PATH, LOCAL_TRANSCRIBE_PATH].sort())
  })

  it('D14-5 stay-out: F1 sources never write Application Support/dsh-desktop', async () => {
    const files = [
      'packages/abaco-effect-broker/index.js',
      'packages/abaco-effect-broker/admission.js',
      'packages/abaco-mediacion-pilot/index.js',
      'packages/abaco-voice/index.js',
      'src/main/index.ts',
    ]
    for (const rel of files) {
      const src = await readFile(join(DESK, rel), 'utf8')
      expect(src, rel).not.toMatch(/Application Support\/dsh-desktop/)
    }
    const main = await readFile(join(DESK, 'src/main/index.ts'), 'utf8')
    expect(main).toContain("app.setPath('userData', join(app.getPath('appData'), 'abaco-deep-core'))")
  })

  it('D14-7 evolution: unauthorized deny does not stop a new grant on admitted voice', () => {
    const blocked = authorize({
      channel: { kind: 'cordis.host', pluginId: 'abaco-brand' },
      task_id: null,
      effect: { kind: 'host.fetch', resource: '/x', args_hash: 'x' },
      trust_in: 'user',
    })
    assertDenyFour(blocked)
    expect(blocked.reason).toBe('plugin-disabled')

    const g = issueTaskGrant({
      pluginId: 'abaco-voice',
      effects: ['host.fetch'],
      resources: [STATUS_PATH],
    })
    const happy = authorize({
      channel: { kind: 'host.fetch', path: STATUS_PATH },
      task_id: g.task_id,
      grant_id: g.grant_id,
      effect: {
        kind: 'host.fetch',
        resource: STATUS_PATH,
        args_hash: hashArgs({ method: 'GET' }),
      },
      trust_in: 'user',
    })
    expect(happy.decision).toBe('allow')
    expect(getBrokerStats().allowCount).toBeGreaterThan(0)
  })

  it('D14-6 patch.yml lists the piloto and does not rehab disabled plugins', async () => {
    const patch = await readFile(join(DESK, 'build/dsh-desktop.patch.yml'), 'utf8')
    expect(patch).toContain('id: abaco-mediacion-pilot')
    expect(patch).toMatch(/TEMPORARILY DISABLED/)
    const afterNote = patch.split('TEMPORARILY DISABLED')[1] || ''
    expect(afterNote).not.toMatch(/- insert:\s*\n\s*- id: abaco-brand/)
  })
})
