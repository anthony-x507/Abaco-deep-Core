/**
 * OpenAI provider: TTS (audio/speech) + STT (Whisper).
 *
 * Audio is uploaded to api.openai.com. The user must explicitly opt in via
 * the disclosure dialog; the API key is stored in Keychain via the settings
 * plugin and never written to plain settings.yaml.
 *
 * Pricing (as of 2026): TTS $15/M chars, Whisper $0.006/min.
 */
import { registerProvider } from '../registry.js'

// ── TTS ────────────────────────────────────────────────────────────────

const VOICES = [
  { value: 'alloy', label: 'Alloy — neutral, balanced' },
  { value: 'ash', label: 'Ash — clear, professional' },
  { value: 'ballad', label: 'Ballad — warm, expressive' },
  { value: 'coral', label: 'Coral — bright, friendly' },
  { value: 'echo', label: 'Echo — smooth, conversational' },
  { value: 'sage', label: 'Sage — calm, measured' },
  { value: 'shimmer', label: 'Shimmer — soft, gentle' },
  { value: 'verse', label: 'Verse — articulate, dramatic' },
]

const MODELS = [
  { value: 'gpt-4o-mini-tts', label: 'GPT-4o mini TTS — fast, affordable' },
  { value: 'tts-1', label: 'TTS-1 — optimized for real-time' },
  { value: 'tts-1-hd', label: 'TTS-1 HD — highest quality' },
]

const ttsProvider = {
  id: 'openai-tts',
  kind: 'tts',
  label: 'OpenAI',
  capabilities: {
    languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'zh', 'ja', 'ko', 'hi', 'ar', 'ru'],
    requiresKey: true,
    offline: false,
    costPer1kChars: 0.015,
    privacyNote: 'Audio bytes leave the device.',
  },
  configSchema: [
    { key: 'apiKey', label: 'API Key', type: 'secret' },
    { key: 'model', label: 'Model', type: 'select', options: MODELS, default: 'gpt-4o-mini-tts' },
    { key: 'voice', label: 'Voice', type: 'select', options: VOICES, default: 'alloy' },
    { key: 'speed', label: 'Speed', type: 'range', min: 0.25, max: 4, step: 0.05, default: 1 },
    { key: 'instructions', label: 'Voice instructions', type: 'text', placeholder: 'e.g. Speak in a calm, professional tone' },
  ],
  defaultConfig: { model: 'gpt-4o-mini-tts', voice: 'alloy', speed: 1, instructions: '' },

  async synthesize(text, opts) {
    if (!opts.apiKey) throw new Error('OpenAI API key required')
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: opts.model,
        input: text,
        voice: opts.voice,
        speed: opts.speed,
        ...(opts.instructions ? { instructions: opts.instructions } : {}),
      }),
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`OpenAI TTS ${res.status}: ${body}`)
    }
    const blob = await res.blob()
    return { kind: 'blob', blob, mimeType: blob.type || 'audio/mpeg' }
  },
}

// ── STT (Whisper) ──────────────────────────────────────────────────────

const STT_MODELS = [
  { value: 'whisper-1', label: 'Whisper-1 — recommended' },
  { value: 'gpt-4o-transcribe', label: 'GPT-4o Transcribe — latest' },
  { value: 'gpt-4o-mini-transcribe', label: 'GPT-4o mini Transcribe — fast' },
]

const sttProvider = {
  id: 'openai-stt',
  kind: 'stt',
  label: 'OpenAI Whisper',
  capabilities: {
    languages: '99+ supported',
    requiresKey: true,
    offline: false,
    costPerMinute: 0.006,
    privacyNote: 'Audio bytes leave the device.',
  },
  configSchema: [
    { key: 'apiKey', label: 'API Key', type: 'secret' },
    { key: 'model', label: 'Model', type: 'select', options: STT_MODELS, default: 'whisper-1' },
    { key: 'language', label: 'Language (optional)', type: 'text', placeholder: 'es, en, auto...' },
    {
      key: 'prompt',
      label: 'Prompt hint',
      type: 'text',
      placeholder: 'cerrajería, programación, VIN, inmovilizador...',
    },
  ],
  defaultConfig: { model: 'whisper-1', language: '', prompt: '' },

  async transcribe(audioBlob, opts) {
    if (!opts.apiKey) throw new Error('OpenAI API key required')
    const form = new FormData()
    form.append('file', audioBlob, 'audio.webm')
    form.append('model', opts.model || 'whisper-1')
    if (opts.language) form.append('language', opts.language)
    if (opts.prompt) form.append('prompt', opts.prompt)
    form.append('response_format', 'verbose_json')
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.apiKey}` },
      body: form,
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`OpenAI STT ${res.status}: ${body}`)
    }
    const json = await res.json()
    return {
      text: json.text,
      language: json.language,
      segments: json.segments,
      duration: json.duration,
    }
  },
}

// ── register ───────────────────────────────────────────────────────────

registerProvider(ttsProvider)
registerProvider(sttProvider)

export default [ttsProvider, sttProvider]