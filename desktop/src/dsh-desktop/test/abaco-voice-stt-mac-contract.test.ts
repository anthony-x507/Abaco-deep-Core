import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CLOUD_STT_PROVIDER_IDS,
  LINUX_STT_HINT_15_16,
  LOCAL_WHISPER_PROVIDER_ID,
  STT_PRODUCT_PLATFORM,
  denySilentCloudSttFallback,
  isMacLocalSttPlatform,
  isProductLocalWhisper,
  linuxSttDeferredHint,
  macLocalSttAdmission,
  sttPlatformHint,
} from '../packages/abaco-voice/lib/stt-mac-contract.js'
import {
  apply,
  LOCAL_STATUS_PATH,
  LOCAL_TRANSCRIBE_PATH,
} from '../packages/abaco-voice/index.js'
import { DISABLED_PLUGINS } from '../packages/abaco-effect-broker/index.js'

function stripComments(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

async function registerVoiceRoutes() {
  const registry: Array<{ path: string; methods: string[]; fetch: (req: Request) => Promise<Response> }> = []
  apply({
    connection: {
      fetch: {
        register: (entry: (typeof registry)[number]) => {
          registry.push(entry)
        },
      },
    },
  } as never)
  return registry
}

describe('F2.1-C STT Mac contract (G1–G7)', () => {
  it('G1 Mac-only: darwin admits; linux/win32 fail-closed with §15/16 hint', () => {
    expect(STT_PRODUCT_PLATFORM).toBe('darwin')
    expect(isMacLocalSttPlatform('darwin')).toBe(true)
    expect(isMacLocalSttPlatform('linux')).toBe(false)
    expect(isMacLocalSttPlatform('win32')).toBe(false)
    expect(macLocalSttAdmission('darwin')).toEqual({ ok: true, hint: null, error: null })
    expect(sttPlatformHint('darwin')).toBeNull()
    const linux = macLocalSttAdmission('linux')
    expect(linux.ok).toBe(false)
    expect(linux.hint).toBe(LINUX_STT_HINT_15_16)
    expect(linux.error).toBe(LINUX_STT_HINT_15_16)
    expect(macLocalSttAdmission('win32').ok).toBe(false)
    expect(isProductLocalWhisper(LOCAL_WHISPER_PROVIDER_ID)).toBe(true)
    expect(isProductLocalWhisper('openai-stt')).toBe(false)
  })

  it('G2 no silent cloud fallback from local-whisper', () => {
    expect(CLOUD_STT_PROVIDER_IDS).toEqual(['openai-stt', 'deepgram-stt', 'deepgram'])
    expect(denySilentCloudSttFallback('local-whisper-stt', 'openai-stt')).toEqual({
      deny: true,
      reason: 'silent-cloud-stt-fallback',
    })
    expect(denySilentCloudSttFallback('local-whisper-stt', 'deepgram-stt').deny).toBe(true)
    expect(denySilentCloudSttFallback('local-whisper-stt', 'local-whisper-stt').deny).toBe(false)
    expect(denySilentCloudSttFallback('openai-stt', 'openai-stt').deny).toBe(false)
  })

  it('G3 Linux §15/16 hint is fail-closed (Whisper local, no OpenAI key, no pip/brew)', () => {
    const hint = linuxSttDeferredHint()
    expect(hint).toBe(LINUX_STT_HINT_15_16)
    expect(hint).toMatch(/§15\/16/)
    expect(hint).toMatch(/Whisper local|mlx-whisper|ffmpeg/i)
    expect(hint).not.toMatch(/OpenAI API key required/i)
    expect(hint).not.toContain('pipx')
    expect(hint).not.toContain('brew install')
    expect(sttPlatformHint('linux')).toBe(hint)
  })

  it('G4 host wires admission + broker grant path; worker refuses unmediated work', async () => {
    const host = await readFile('packages/abaco-voice/index.js', 'utf8')
    const worker = await readFile('packages/abaco-mediacion-pilot/worker.js', 'utf8')
    const broker = await readFile('packages/abaco-effect-broker/index.js', 'utf8')
    expect(host).toContain('macLocalSttAdmission')
    expect(host).toContain('sttPlatformHint')
    expect(host).toContain('authorize(')
    expect(host).toContain('executeAuthorized')
    expect(host).not.toMatch(/\bspawn\s*\(/)
    expect(worker).toContain('missing grantId')
    expect(worker).toContain('NEVER calls broker.grant')
    expect(broker).toContain("if (channel.path && String(channel.path).startsWith('/api/abaco-voice.')) return 'abaco-voice'")
    expect(broker).toContain('Auto-issue ephemeral task grant for host.fetch voice routes')
  })

  it('G5 compact 0.90 / 0.12 / 8192 untouched; no dsh-desktop profile / disabled-plugin rehab', async () => {
    const preset = await readFile(
      resolve('packages/abaco-context/presets/abaco/agent.cordis.yml'),
      'utf8',
    )
    const row = preset.match(
      /-\s*id:\s*compaction-basic[\s\S]*?thresholdRatio:\s*([0-9.]+)[\s\S]*?retainRatio:\s*([0-9.]+)[\s\S]*?maxTokens:\s*([0-9]+)/,
    )
    expect(row).toBeTruthy()
    expect(Number(row?.[1])).toBe(0.9)
    expect(Number(row?.[2])).toBe(0.12)
    expect(Number(row?.[3])).toBe(8192)

    const diff = execFileSync('git', ['diff', '--name-only'], { encoding: 'utf8' })
    const changed = diff
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    for (const file of changed) {
      expect(file.includes('abaco-context')).toBe(false)
      expect(/dsh-desktop\.patch\.yml|profile-startup|DISABLED_PLUGINS/i.test(file)).toBe(false)
    }
    expect(DISABLED_PLUGINS.has('abaco-brand')).toBe(true)
    expect(DISABLED_PLUGINS.has('abaco-voice')).toBe(false)
  })

  it('G6 fail-closed live: non-Mac transcribe 503 + status hint; 0 OpenAI key copy', async () => {
    const registry = await registerVoiceRoutes()
    const status = registry.find((r) => r.path === LOCAL_STATUS_PATH)!
    const transcribe = registry.find((r) => r.path === LOCAL_TRANSCRIBE_PATH)!
    expect(status).toBeTruthy()
    expect(transcribe).toBeTruthy()

    const statusRes = await status.fetch(new Request(`http://abaco.local${LOCAL_STATUS_PATH}`))
    expect(statusRes.status).toBe(200)
    const statusBody = (await statusRes.json()) as {
      ok: boolean
      available: boolean
      hint: string | null
      mac_only?: boolean
    }
    expect(statusBody.ok).toBe(true)
    expect(statusBody.mac_only).toBe(true)
    if (process.platform === 'darwin') {
      expect(statusBody.hint).toBeNull()
    } else {
      expect(statusBody.available).toBe(false)
      expect(String(statusBody.hint)).toMatch(/mlx-whisper|ffmpeg|Whisper local/i)
      expect(String(statusBody.hint)).not.toMatch(/OpenAI API key required/i)
    }

    if (process.platform !== 'darwin') {
      const res = await transcribe.fetch(
        new Request(`http://abaco.local${LOCAL_TRANSCRIBE_PATH}?filename=audio.webm`, {
          method: 'POST',
          body: new Uint8Array([1, 2, 3, 4]),
        }),
      )
      expect(res.status).toBe(503)
      const body = (await res.json()) as { ok: boolean; error?: string }
      expect(body.ok).toBe(false)
      expect(String(body.error)).toBe(LINUX_STT_HINT_15_16)
    }
  })

  it('G7 naming: Janice = runtime in comments; Atena absent from executable voice host', async () => {
    const host = await readFile('packages/abaco-voice/index.js', 'utf8')
    const helper = await readFile('packages/abaco-voice/lib/stt-mac-contract.js', 'utf8')
    const worker = await readFile('packages/abaco-mediacion-pilot/worker.js', 'utf8')
    const contract = await readFile(
      resolve('../../../docs/contracts/CONTRACT-F2.1-C-STT-MAC.md'),
      'utf8',
    )
    expect(contract).toContain('Janice = runtime')
    expect(contract).toMatch(/Atena/)
    expect(contract).toContain('cero Atena')
    expect(host).toContain('Janice = runtime')
    expect(helper).toContain('Janice = runtime')
    expect(worker).toContain('Cero Atena')
    const hostCode = stripComments(host)
    const helperCode = stripComments(helper)
    expect(hostCode).not.toMatch(/\bAtena\b/)
    expect(helperCode).not.toMatch(/\bAtena\b/)
    expect(helperCode).not.toMatch(/\bJanice\b/)
  })
})
