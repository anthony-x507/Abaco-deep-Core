/**
 * ElevenLabs TTS provider (stub).
 *
 * Premium neural voices, voice cloning, multi-language. Highest quality in
 * the industry. Paid. This is a registry stub — wire it up when the user
 * provides an ElevenLabs API key.
 *
 * Docs: https://docs.elevenlabs.io/api-reference/text-to-speech
 */
import { registerProvider } from '../registry.js'

const provider = {
  id: 'elevenlabs-tts',
  kind: 'tts',
  label: 'ElevenLabs (premium)',
  capabilities: {
    languages: '29 languages',
    requiresKey: true,
    offline: false,
    costPer1kChars: 0.18, // varies by plan
    privacyNote: 'Audio bytes leave the device.',
  },
  configSchema: [
    { key: 'apiKey', label: 'API Key', type: 'secret' },
    { key: 'voiceId', label: 'Voice ID', type: 'text', placeholder: 'elevenlabs voice ID' },
    { key: 'model', label: 'Model', type: 'select', options: [
      { value: 'eleven_multilingual_v2', label: 'Multilingual v2 (recommended)' },
      { value: 'eleven_turbo_v2_5', label: 'Turbo v2.5 (low latency)' },
      { value: 'eleven_flash_v2_5', label: 'Flash v2.5 (fastest)' },
    ], default: 'eleven_multilingual_v2' },
    { key: 'stability', label: 'Stability', type: 'range', min: 0, max: 1, step: 0.05, default: 0.5 },
    { key: 'similarityBoost', label: 'Clarity', type: 'range', min: 0, max: 1, step: 0.05, default: 0.75 },
  ],
  defaultConfig: {
    model: 'eleven_multilingual_v2',
    stability: 0.5,
    similarityBoost: 0.75,
  },

  async synthesize(text, opts) {
    if (!opts.apiKey) throw new Error('ElevenLabs API key required')
    if (!opts.voiceId) throw new Error('ElevenLabs voiceId required')
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${opts.voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': opts.apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: opts.model,
        voice_settings: {
          stability: opts.stability,
          similarity_boost: opts.similarityBoost,
        },
      }),
    })
    if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`)
    return { kind: 'blob', blob: await res.blob(), mimeType: 'audio/mpeg' }
  },
}

registerProvider(provider)

export default provider