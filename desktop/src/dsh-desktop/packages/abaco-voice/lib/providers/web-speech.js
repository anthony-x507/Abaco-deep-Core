/**
 * Web Speech API provider.
 *
 * Wraps the browser-native SpeechSynthesis (TTS) and webkitSpeechRecognition
 * (STT) interfaces. Free, offline-capable when the browser supports it, no
 * API key. Quality varies by browser/OS voice inventory.
 *
 * No audio bytes leave the device.
 */
import { registerProvider } from '../registry.js'

// ── TTS ────────────────────────────────────────────────────────────────

const ttsProvider = {
  id: 'web-speech-tts',
  kind: 'tts',
  label: 'Web Speech (browser)',
  capabilities: {
    languages: 'system-dependent',
    requiresKey: false,
    offline: 'partial',
    costPer1kChars: 0,
  },
  configSchema: [
    {
      key: 'voiceURI',
      label: 'Voice',
      type: 'select',
      options: 'voices', // populated dynamically from getVoices()
    },
    {
      key: 'rate',
      label: 'Speed',
      type: 'range',
      min: 0.5,
      max: 2,
      step: 0.1,
      default: 1,
    },
    {
      key: 'pitch',
      label: 'Pitch',
      type: 'range',
      min: 0,
      max: 2,
      step: 0.1,
      default: 1,
    },
  ],
  defaultConfig: { voiceURI: '', rate: 1, pitch: 1 },

  async listVoices() {
    if (typeof speechSynthesis === 'undefined') return []
    return new Promise((resolve) => {
      let voices = speechSynthesis.getVoices()
      if (voices.length) return resolve(voices)
      const onVoices = () => {
        voices = speechSynthesis.getVoices()
        speechSynthesis.removeEventListener('voiceschanged', onVoices)
        resolve(voices)
      }
      speechSynthesis.addEventListener('voiceschanged', onVoices)
    })
  },

  synthesize(text, opts) {
    return new Promise((resolve, reject) => {
      if (typeof speechSynthesis === 'undefined') {
        return reject(new Error('SpeechSynthesis not available in this environment'))
      }
      const u = new SpeechSynthesisUtterance(text)
      if (opts.voiceURI) {
        const v = speechSynthesis.getVoices().find((x) => x.voiceURI === opts.voiceURI)
        if (v) u.voice = v
      }
      u.rate = opts.rate ?? 1
      u.pitch = opts.pitch ?? 1
      u.onend = () => resolve({ kind: 'native', utterance: u })
      u.onerror = (e) => reject(new Error(`SpeechSynthesis error: ${e.error}`))
      speechSynthesis.cancel()
      speechSynthesis.speak(u)
    })
  },

  cancel() {
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
  },
}

// ── STT ────────────────────────────────────────────────────────────────

const sttProvider = {
  id: 'web-speech-stt',
  kind: 'stt',
  label: 'Web Speech (browser)',
  capabilities: {
    languages: 'system-dependent',
    requiresKey: false,
    offline: 'partial',
    costPerMinute: 0,
  },
  configSchema: [
    {
      key: 'language',
      label: 'Language',
      type: 'select',
      options: [
        { value: 'es-ES', label: 'Español (España)' },
        { value: 'es-MX', label: 'Español (México)' },
        { value: 'es-AR', label: 'Español (Argentina)' },
        { value: 'en-US', label: 'English (US)' },
        { value: 'en-GB', label: 'English (UK)' },
        { value: 'pt-BR', label: 'Português (Brasil)' },
        { value: 'zh-CN', label: '中文 (简体)' },
      ],
    },
    { key: 'continuous', label: 'Continuous', type: 'boolean', default: false },
  ],
  defaultConfig: { language: 'es-ES', continuous: false },

  createRecognizer(opts) {
    const Ctor =
      typeof window !== 'undefined'
        ? window.SpeechRecognition || window.webkitSpeechRecognition
        : null
    if (!Ctor) throw new Error('SpeechRecognition not available in this browser')
    const rec = new Ctor()
    rec.lang = opts.language || 'es-ES'
    rec.continuous = !!opts.continuous
    rec.interimResults = true
    return rec
  },
}

// ── register ───────────────────────────────────────────────────────────

registerProvider(ttsProvider)
registerProvider(sttProvider)

export default [ttsProvider, sttProvider]