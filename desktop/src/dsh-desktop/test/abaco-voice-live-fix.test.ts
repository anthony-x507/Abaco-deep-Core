import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

/**
 * LIVE fix evidence (Anthony 2026-09-10):
 * 1) composer crash "cannot get property store without inject"
 * 2) Electron has no SpeechRecognition → MediaRecorder + Whisper/Deepgram
 */
describe('abaco-voice live fix (store inject + Electron STT)', () => {
  it('never reads Cordis ctx.store / __abaco_ctx.store from the mic path', async () => {
    const source = await readFile('packages/abaco-voice/client.js', 'utf8')
    expect(source).not.toMatch(/__abaco_ctx\.store/)
    expect(source).not.toMatch(/window\.__abaco_ctx\s*=\s*ctx/)
    expect(source).toContain('window.__abaco_voice_store')
    expect(source).toContain('delete window.__abaco_ctx')
    expect(source).toContain('window.__abaco_inputActions = actions')
    // Plain bag only for setDraft fallback
    expect(source).toContain('win && win.__abaco_inputActions')
    expect(source).not.toMatch(/__abaco_ctx\s*&&\s*win\.__abaco_ctx\.inputActions/)
  })

  it('defaults to local-whisper-stt and forces MediaRecorder when SpeechRecognition is missing', async () => {
    const source = await readFile('packages/abaco-voice/client.js', 'utf8')
    expect(source).toMatch(/sttProvider:\s*'local-whisper-stt'/)
    expect(source).toContain('function speechRecognitionAvailable()')
    expect(source).toContain('function pickBlobSttProvider(cfg)')
    expect(source).toContain('MediaRecorder → provider.transcribe(blob)')
    expect(source).toContain("Whisper local (macOS)")
  })

  it('gates blob STT on provider API key before MediaRecorder (DEEPSEEK ≠ Whisper)', async () => {
    const source = await readFile('packages/abaco-voice/client.js', 'utf8')
    expect(source).toContain('function providerHasApiKey(cfg, provider)')
    expect(source).toContain('function assertBlobSttReady(cfg, provider)')
    expect(source).toContain('assertBlobSttReady(cfg, provider)')
    expect(source).toContain('La clave DEEPSEEK de Modelos no sirve para STT')
    expect(source).toContain('Falta API key de OpenAI Whisper')
  })

  it('device-identity / experimental / onboarding do not touch undeclared ctx.abaco', async () => {
    const identity = await readFile('packages/abaco-device-identity/client.js', 'utf8')
    const experimental = await readFile('packages/abaco-experimental/client.js', 'utf8')
    const onboarding = await readFile('packages/abaco-onboarding/client.js', 'utf8')
    expect(identity).not.toMatch(/ctx\.abaco/)
    expect(identity).toContain('__abaco_services')
    expect(experimental).not.toMatch(/ctx\.abaco/)
    expect(onboarding).not.toMatch(/ctx\.abaco/)
  })
})
