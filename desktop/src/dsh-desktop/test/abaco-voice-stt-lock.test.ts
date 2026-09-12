import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LOCAL_LANGUAGE,
  DEFAULT_LOCAL_MODEL,
  LOCAL_WHISPER_ID,
  normalizeVoiceConfig,
  resolveLocalWhisperModel,
} from '../packages/abaco-voice/lib/normalize-config.js'

describe('abaco-voice STT lock (P0 mic)', () => {
  it('defaults to whisper-tiny + es; preserves base-mlx; coerces plain base', () => {
    expect(DEFAULT_LOCAL_MODEL).toBe('mlx-community/whisper-tiny')
    expect(DEFAULT_LOCAL_LANGUAGE).toBe('es')
    expect(LOCAL_WHISPER_ID).toBe('local-whisper-stt')
    expect(resolveLocalWhisperModel('mlx-community/whisper-base')).toBe('mlx-community/whisper-base-mlx')
    expect(resolveLocalWhisperModel('mlx-community/whisper-small')).toBe('mlx-community/whisper-small-mlx')
    expect(resolveLocalWhisperModel('mlx-community/whisper-base-mlx')).toBe('mlx-community/whisper-base-mlx')
    expect(resolveLocalWhisperModel('')).toBe('mlx-community/whisper-tiny')
  })

  it('coerces openai-stt without API key to local-whisper-stt', () => {
    const { config, changed } = normalizeVoiceConfig({
      sttProvider: 'openai-stt',
      providers: { 'openai-stt': { apiKey: '   ' } },
    })
    expect(changed).toBe(true)
    expect(config.sttProvider).toBe('local-whisper-stt')
    expect(config.providers['local-whisper-stt'].model).toBe('mlx-community/whisper-tiny')
    expect(config.providers['local-whisper-stt'].language).toBe('es')
  })

  it('keeps openai-stt when a non-empty API key is present', () => {
    const { config } = normalizeVoiceConfig({
      sttProvider: 'openai-stt',
      providers: {
        'openai-stt': { apiKey: 'sk-test' },
        'local-whisper-stt': { model: 'mlx-community/whisper-tiny', language: 'es' },
      },
    })
    expect(config.sttProvider).toBe('openai-stt')
  })

  it('coerces stored plain whisper-base → whisper-base-mlx', () => {
    const { config, changed } = normalizeVoiceConfig({
      sttProvider: 'local-whisper-stt',
      providers: { 'local-whisper-stt': { model: 'mlx-community/whisper-base', language: 'es' } },
    })
    expect(changed).toBe(true)
    expect(config.providers['local-whisper-stt'].model).toBe('mlx-community/whisper-base-mlx')
  })

  it('client + host never default to plain whisper-base; local empty ≠ API key', async () => {
    const client = await readFile('packages/abaco-voice/client.js', 'utf8')
    const host = await readFile('packages/abaco-voice/index.js', 'utf8')
    const ops = await readFile('packages/abaco-mediacion-pilot/ops.js', 'utf8')
    expect(client).toContain("sttProvider: 'local-whisper-stt'")
    expect(client).toContain("DEFAULT_LOCAL_MODEL = 'mlx-community/whisper-tiny'")
    expect(client).toContain('whisper-base-mlx')
    expect(client).toContain('No es API key')
    expect(client).not.toMatch(/value:\s*'mlx-community\/whisper-base'/)
    expect(client).not.toMatch(/\.includes\(['\"]whisper-base['\"]\)/)
    expect(host).toContain("const DEFAULT_MODEL = 'mlx-community/whisper-tiny'")
    expect(host).not.toMatch(/\.includes\(['\"]whisper-base['\"]\)/)
    expect(ops).toContain("const DEFAULT_MODEL = 'mlx-community/whisper-tiny'")
    expect(ops).toContain('Repository Not Found')
    expect(ops).toContain('transcripción vacía')
    expect(ops).toContain('No es un problema de API key')
    expect(ops).not.toMatch(/String\(model\)\.includes\('whisper-base'\)/)
  })
})
