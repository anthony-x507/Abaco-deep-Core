import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  apply,
  LOCAL_STATUS_PATH,
  LOCAL_TRANSCRIBE_PATH,
  name,
  resolveLocalWhisperTools,
} from '../packages/abaco-voice/index.js'

describe('abaco-voice local whisper host', () => {
  it('registers status + transcribe routes and declares connection inject', async () => {
    const registry: Array<{ path: string; methods: string[]; fetch: (req: Request) => Promise<Response> }> = []
    apply({
      connection: {
        fetch: {
          register: (entry: (typeof registry)[number]) => { registry.push(entry) },
        },
      },
    } as never)
    expect(name).toBe('abaco-voice')
    expect(registry.map((r) => r.path).sort()).toEqual([LOCAL_STATUS_PATH, LOCAL_TRANSCRIBE_PATH].sort())
  })

  it('resolves mlx_whisper + ffmpeg on this Mac (or reports install hint)', async () => {
    const tools = await resolveLocalWhisperTools()
    // CI/box may lack bins; on Anthony Mac they should exist.
    expect(tools).toHaveProperty('available')
    expect(tools).toHaveProperty('engine')
    expect(tools).toHaveProperty('ffmpeg')
    if (tools.available) {
      expect(tools.engine).toMatch(/mlx_whisper|whisper/)
      expect(tools.bin).toBeTruthy()
      expect(tools.ffmpeg).toBeTruthy()
    }
  })

  it('status route returns JSON without OpenAI key messaging', async () => {
    const registry: Array<{ path: string; methods: string[]; fetch: (req: Request) => Promise<Response> }> = []
    apply({
      connection: {
        fetch: {
          register: (entry: (typeof registry)[number]) => { registry.push(entry) },
        },
      },
    } as never)
    const status = registry.find((r) => r.path === LOCAL_STATUS_PATH)!
    const res = await status.fetch(new Request(`http://abaco.local${LOCAL_STATUS_PATH}`))
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; available: boolean; hint: string | null }
    expect(body.ok).toBe(true)
    if (!body.available) {
      expect(String(body.hint)).toMatch(/mlx-whisper|ffmpeg|Whisper local/i)
      expect(String(body.hint)).not.toMatch(/OpenAI API key required/i)
    }
  })

  it('client defaults to local-whisper and never requires OpenAI for that path', async () => {
    const source = await readFile('packages/abaco-voice/client.js', 'utf8')
    expect(source).toContain("id: 'local-whisper-stt'")
    expect(source).toMatch(/sttProvider:\s*'local-whisper-stt'/)
    expect(source).toContain("DEFAULT_LOCAL_MODEL = 'mlx-community/whisper-tiny'")
    expect(source).toContain('normalizeVoiceConfig')
    expect(source).toContain('/api/abaco-voice.local-transcribe')
    expect(source).toContain("requiresKey: false")
    expect(source).not.toMatch(/window\.__abaco_ctx\s*=\s*ctx/)
  })
})
