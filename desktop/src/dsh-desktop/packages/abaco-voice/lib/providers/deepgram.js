/**
 * Deepgram STT provider (Nova-3 model).
 *
 * Fast, high-accuracy transcription. Supports real-time streaming and batch.
 * Pricing: ~$0.0043/min (Pay-as-you-go Nova-3).
 *
 * Docs: https://developers.deepgram.com/reference/listen-file
 */
import { registerProvider } from '../registry.js'

const provider = {
  id: 'deepgram-stt',
  kind: 'stt',
  label: 'Deepgram Nova-3',
  capabilities: {
    languages: '36+ languages',
    requiresKey: true,
    offline: false,
    costPerMinute: 0.0043,
    privacyNote: 'Audio bytes leave the device.',
  },
  configSchema: [
    { key: 'apiKey', label: 'API Key', type: 'secret' },
    { key: 'model', label: 'Model', type: 'select', options: [
      { value: 'nova-3', label: 'Nova-3 (latest, recommended)' },
      { value: 'nova-2', label: 'Nova-2' },
      { value: 'whisper-large', label: 'Whisper Large (Deepgram-hosted)' },
    ], default: 'nova-3' },
    { key: 'language', label: 'Language', type: 'select', options: [
      { value: 'es', label: 'Español' },
      { value: 'en', label: 'English' },
      { value: 'pt', label: 'Português' },
      { value: 'zh', label: '中文' },
      { value: 'multi', label: 'Multi-language (auto)' },
    ], default: 'multi' },
    { key: 'smartFormat', label: 'Smart formatting', type: 'boolean', default: true },
    { key: 'keywords', label: 'Vocabulary hints', type: 'text', placeholder: 'cerrajería:5, VIN:4, inmovilizador:3, BMW:2, FEM:3, CAS:3' },
  ],
  defaultConfig: { model: 'nova-3', language: 'multi', smartFormat: true, keywords: '' },

  async transcribe(audioBlob, opts) {
    if (!opts.apiKey) throw new Error('Deepgram API key required')
    const params = new URLSearchParams({
      model: opts.model,
      smart_format: String(opts.smartFormat ?? true),
    })
    if (opts.language && opts.language !== 'multi') params.set('language', opts.language)
    if (opts.keywords) {
      for (const kw of opts.keywords.split(',').map((s) => s.trim()).filter(Boolean)) {
        params.append('keywords', kw)
      }
    }
    const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${opts.apiKey}`,
        'Content-Type': audioBlob.type || 'audio/wav',
      },
      body: audioBlob,
    })
    if (!res.ok) throw new Error(`Deepgram ${res.status}: ${await res.text()}`)
    const json = await res.json()
    const alt = json?.results?.channels?.[0]?.alternatives?.[0] || {}
    return {
      text: alt.transcript || '',
      language: json?.results?.detected_language || opts.language,
      segments: alt.words || [],
      duration: json?.metadata?.duration,
    }
  },
}

registerProvider(provider)

export default provider