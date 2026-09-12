window.__ModuleLoader__.load({
  id: 'abaco-voice',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement

    // ══════════════════════════════════════════════════════════════════════
    // Self-contained voice engine (inlined from the previous lib/ tree).
    // The web module table only seeds platform ids (react, @deepseek-ai/*),
    // so no `require('./lib/…')` may appear in this bundle. Everything here
    // is browser-only (SpeechSynthesis, SpeechRecognition, MediaRecorder,
    // getUserMedia, fetch) and needs no Node side.
    // ══════════════════════════════════════════════════════════════════════

    // ── Provider registry ────────────────────────────────────────────────

    const providers = new Map()

    function registerProvider(provider) {
      if (!provider || !provider.id || !provider.kind) {
        throw new Error('abaco-voice: provider must have id and kind')
      }
      if (providers.has(provider.id)) {
        throw new Error(`abaco-voice: provider "${provider.id}" already registered`)
      }
      providers.set(provider.id, provider)
    }

    function getProvider(id) {
      return providers.get(id)
    }

    function listProviders(kind) {
      const out = []
      for (const p of providers.values()) {
        if (!kind || p.kind === kind) out.push(p)
      }
      return out
    }

    // ── Config persistence (store-shaped dependency, inlined) ────────────

    const STORE_KEY = 'abaco-voice:config'

    const defaultConfig = {
      ttsProvider: 'web-speech-tts',
      // Electron: on-device mlx_whisper / whisper via host route (no OpenAI key).
      // Cloud OpenAI/Deepgram remain optional in Ajustes → Voz.
      sttProvider: 'local-whisper-stt',
      providers: {},
      privacy: {
        disclosureAccepted: false,
        disclosureAcceptedAt: null,
        rememberTranscriptDays: 0,
      },
    }

    function defaultVoiceConfig() {
      return JSON.parse(JSON.stringify(defaultConfig))
    }

    // Schema default ALWAYS small-mlx + es (Arq). Tiny = dropdown option only.
    const DEFAULT_LOCAL_MODEL = 'mlx-community/whisper-small-mlx'
    const DEFAULT_LOCAL_LANGUAGE = 'es'
    // Exact BAD plain ids only — never substring-match whisper-base (would kill base-mlx).
    const BAD_LOCAL_MODEL_MAP = {
      'mlx-community/whisper-base': 'mlx-community/whisper-base-mlx',
      'whisper-base': 'mlx-community/whisper-base-mlx',
      'mlx-community/whisper-small': 'mlx-community/whisper-small-mlx',
      'whisper-small': 'mlx-community/whisper-small-mlx',
    }
    const KNOWN_GOOD_LOCAL_MODELS = [
      'mlx-community/whisper-small-mlx',
      'mlx-community/whisper-base-mlx',
      'mlx-community/whisper-tiny-mlx',
      'mlx-community/whisper-tiny',
    ]

    function resolveLocalWhisperModel(model) {
      const raw = model != null ? String(model).trim() : ''
      if (!raw) return DEFAULT_LOCAL_MODEL
      if (Object.prototype.hasOwnProperty.call(BAD_LOCAL_MODEL_MAP, raw)) return BAD_LOCAL_MODEL_MAP[raw]
      if (KNOWN_GOOD_LOCAL_MODELS.includes(raw)) return raw
      return DEFAULT_LOCAL_MODEL
    }

    /** Lock STT: openai without key → local-whisper; exact BAD → *-mlx; write-through. */
    function normalizeVoiceConfig(raw) {
      const base = defaultVoiceConfig()
      const incoming = raw && typeof raw === 'object' ? raw : {}
      const cfg = {
        ...base,
        ...incoming,
        providers: { ...(incoming.providers || {}) },
        privacy: { ...base.privacy, ...(incoming.privacy || {}) },
      }
      let changed = false
      const requiresKeyIds = ['openai-stt', 'deepgram-stt', 'deepgram']
      if (requiresKeyIds.includes(cfg.sttProvider)) {
        const key = ((cfg.providers || {})[cfg.sttProvider] || {}).apiKey
        if (!key || !String(key).trim()) {
          cfg.sttProvider = 'local-whisper-stt'
          changed = true
        }
      }
      if (!cfg.sttProvider || cfg.sttProvider === 'web-speech-stt') {
        cfg.sttProvider = 'local-whisper-stt'
        changed = true
      }
      const lwPrev = cfg.providers['local-whisper-stt'] || {}
      const lw = { ...lwPrev }
      const resolved = resolveLocalWhisperModel(lw.model)
      if (lw.model !== resolved) {
        lw.model = resolved
        changed = true
      }
      const lang = lw.language != null ? String(lw.language).trim() : ''
      if (!lang) {
        lw.language = DEFAULT_LOCAL_LANGUAGE
        changed = true
      }
      if (JSON.stringify(lwPrev) !== JSON.stringify(lw)) {
        cfg.providers['local-whisper-stt'] = lw
        changed = true
      }
      return { config: cfg, changed }
    }

    async function loadConfig(store) {
      const raw = store ? await store.get(STORE_KEY) : null
      if (!raw) return defaultVoiceConfig()
      try {
        const { config, changed } = normalizeVoiceConfig(JSON.parse(raw))
        // Persist coercion so openai-stt cannot stick without a valid key.
        if (changed && store) {
          try { await saveConfig(store, config) } catch {}
        }
        return config
      } catch {
        return defaultVoiceConfig()
      }
    }

    async function saveConfig(store, config) {
      if (!store) return
      // Q5/T2: ALWAYS normalize before persist.
      const { config: normalized } = normalizeVoiceConfig(config)
      await store.set(STORE_KEY, JSON.stringify(normalized))
    }

    async function setProviderConfig(store, providerId, partial) {
      const cfg = await loadConfig(store)
      cfg.providers[providerId] = { ...(cfg.providers[providerId] || {}), ...partial }
      await saveConfig(store, cfg)
      return cfg.providers[providerId]
    }

    // ── Playback ─────────────────────────────────────────────────────────

    let currentAudio = null
    let currentNative = null

    async function playbackPlay(audio) {
      playbackStop()
      if (audio.kind === 'native') {
        currentNative = audio.utterance
        return
      }
      const url = audio.kind === 'url' ? audio.url : URL.createObjectURL(audio.blob)
      const a = new Audio(url)
      currentAudio = a
      a.onended = () => {
        if (currentAudio === a) currentAudio = null
        if (audio.kind === 'blob') URL.revokeObjectURL(url)
      }
      a.onerror = () => {
        if (currentAudio === a) currentAudio = null
        if (audio.kind === 'blob') URL.revokeObjectURL(url)
      }
      await a.play()
    }

    function playbackStop() {
      if (currentAudio) {
        try { currentAudio.pause() } catch {}
        currentAudio.src = ''
        currentAudio = null
      }
      if (currentNative && typeof speechSynthesis !== 'undefined') {
        speechSynthesis.cancel()
        currentNative = null
      }
    }

    function playbackIsPlaying() {
      return currentAudio !== null || currentNative !== null
    }

    // ── Recorder ─────────────────────────────────────────────────────────

    let recorder = null
    let recorderStream = null
    let chunks = []
    let startedAt = 0

    function pickMimeType() {
      const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
      if (typeof MediaRecorder === 'undefined') return 'audio/webm'
      for (const t of candidates) {
        if (MediaRecorder.isTypeSupported(t)) return t
      }
      return ''
    }

    function recorderCleanup() {
      if (recorderStream) {
        recorderStream.getTracks().forEach((t) => t.stop())
        recorderStream = null
      }
      recorder = null
    }

    async function recorderStart() {
      if (recorder) return
      if (typeof navigator === 'undefined' || !navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
        throw new Error('getUserMedia no está disponible en este entorno')
      }
      // Real microphone only — NOT getDisplayMedia / chromeMediaSource desktop (P1 monitor).
      recorderStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      })
      const audioTracks = recorderStream.getAudioTracks()
      if (!audioTracks.length) {
        recorderCleanup()
        throw new Error('No se obtuvo pista de micrófono (getUserMedia audio vacío)')
      }
      // Reject accidental desktop/tab capture masquerading as mic.
      for (const t of audioTracks) {
        const settings = typeof t.getSettings === 'function' ? (t.getSettings() || {}) : {}
        if (settings.chromeMediaSource === 'desktop' || settings.displaySurface) {
          recorderCleanup()
          throw new Error('Fuente de audio no es micrófono (desktop/tab). Usa el mic del sistema.')
        }
        try { t.applyConstraints({ echoCancellation: true, noiseSuppression: true, autoGainControl: true }) } catch {}
      }
      chunks = []
      recorder = new MediaRecorder(recorderStream, {
        mimeType: pickMimeType(),
        audioBitsPerSecond: 64000,
      })
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data)
      }
      recorder.start(250)
      startedAt = Date.now()
    }

    function recorderStop() {
      return new Promise((resolve, reject) => {
        if (!recorder) return resolve(null)
        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: recorder.mimeType })
          const duration = (Date.now() - startedAt) / 1000
          recorderCleanup()
          resolve({ blob, duration })
        }
        recorder.onerror = (e) => {
          recorderCleanup()
          reject(new Error(`MediaRecorder error: ${e.error && e.error.message ? e.error.message : (e.error || 'desconocido')}`))
        }
        try {
          recorder.stop()
        } catch (e) {
          recorderCleanup()
          reject(e)
        }
      })
    }

    function recorderCancel() {
      if (!recorder) return
      try { recorder.stop() } catch {}
      chunks = []
      recorderCleanup()
    }

    function recorderIsRecording() {
      return recorder !== null && recorder.state === 'recording'
    }

    // ── Providers (register at materialization) ──────────────────────────

    // Web Speech (browser) — free, no audio leaves the device.
    {
      const voices = {
        'es-ES': 'Español (España)', 'es-MX': 'Español (México)', 'es-AR': 'Español (Argentina)',
        'en-US': 'English (US)', 'en-GB': 'English (UK)', 'pt-BR': 'Português (Brasil)',
        'zh-CN': '中文 (简体)',
      }
      const tts = {
        id: 'web-speech-tts',
        kind: 'tts',
        label: 'Web Speech (browser)',
        capabilities: { languages: 'system-dependent', requiresKey: false, offline: 'partial', costPer1kChars: 0 },
        configSchema: [
          { key: 'voiceURI', label: 'Voice', type: 'select', options: 'voices' },
          { key: 'rate', label: 'Speed', type: 'range', min: 0.5, max: 2, step: 0.1, default: 1 },
          { key: 'pitch', label: 'Pitch', type: 'range', min: 0, max: 2, step: 0.1, default: 1 },
        ],
        defaultConfig: { voiceURI: '', rate: 1, pitch: 1 },
        synthesize(text, opts) {
          return new Promise((resolve, reject) => {
            if (typeof speechSynthesis === 'undefined') {
              return reject(new Error('SpeechSynthesis no está disponible en este entorno'))
            }
            const u = new SpeechSynthesisUtterance(text)
            if (opts.voiceURI) {
              const v = speechSynthesis.getVoices().find((x) => x.voiceURI === opts.voiceURI)
              if (v) u.voice = v
            }
            u.rate = opts.rate == null ? 1 : Number(opts.rate)
            u.pitch = opts.pitch == null ? 1 : Number(opts.pitch)
            u.onend = () => resolve({ kind: 'native', utterance: u })
            u.onerror = (e) => reject(new Error(`SpeechSynthesis error: ${e.error || 'desconocido'}`))
            speechSynthesis.cancel()
            speechSynthesis.speak(u)
          })
        },
      }
      const stt = {
        id: 'web-speech-stt',
        kind: 'stt',
        label: 'Web Speech (browser)',
        // live: true → MicButton drives SpeechRecognition while pressed.
        // MediaRecorder + blob.transcribe: local-whisper / openai / deepgram.
        capabilities: {
          languages: 'system-dependent',
          requiresKey: false,
          offline: 'partial',
          costPerMinute: 0,
          live: true,
        },
        configSchema: [
          {
            key: 'language',
            label: 'Language',
            type: 'select',
            options: Object.keys(voices).map((value) => ({ value, label: `${voices[value]} (${value})` })),
          },
          { key: 'continuous', label: 'Continuous', type: 'boolean', default: false },
        ],
        defaultConfig: { language: 'es-ES', continuous: false },
        createRecognizer(opts) {
          const Ctor = typeof window !== 'undefined'
            ? (window.SpeechRecognition || window.webkitSpeechRecognition)
            : null
          if (!Ctor) {
            throw new Error(
              'SpeechRecognition no está disponible en este entorno (Electron). ' +
              'Cambia el proveedor STT a Whisper local (macOS) en Ajustes → Voz.',
            )
          }
          const rec = new Ctor()
          rec.lang = (opts && opts.language) || 'es-ES'
          rec.continuous = !!(opts && opts.continuous)
          rec.interimResults = true
          return rec
        },
        // Intentionally not blob-based — calling this means the mic path failed to detect live STT.
        transcribe(_blob, _opts) {
          throw new Error(
            'web-speech-stt es live-only: usa SpeechRecognition mientras el mic está pulsado, ' +
            'no MediaRecorder + blob.',
          )
        },
      }
      registerProvider(tts)
      registerProvider(stt)
    }

    // OpenAI — TTS (audio/speech) + STT (Whisper).
    {
      const ttsVoices = [
        { value: 'alloy', label: 'Alloy — neutral, balanced' },
        { value: 'ash', label: 'Ash — clear, professional' },
        { value: 'ballad', label: 'Ballad — warm, expressive' },
        { value: 'coral', label: 'Coral — bright, friendly' },
        { value: 'echo', label: 'Echo — smooth, conversational' },
        { value: 'sage', label: 'Sage — calm, measured' },
        { value: 'shimmer', label: 'Shimmer — soft, gentle' },
        { value: 'verse', label: 'Verse — articulate, dramatic' },
      ]
      const ttsModels = [
        { value: 'gpt-4o-mini-tts', label: 'GPT-4o mini TTS — fast, affordable' },
        { value: 'tts-1', label: 'TTS-1 — optimized for real-time' },
        { value: 'tts-1-hd', label: 'TTS-1 HD — highest quality' },
      ]
      const tts = {
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
          { key: 'model', label: 'Model', type: 'select', options: ttsModels, default: 'gpt-4o-mini-tts' },
          { key: 'voice', label: 'Voice', type: 'select', options: ttsVoices, default: 'alloy' },
          { key: 'speed', label: 'Speed', type: 'range', min: 0.25, max: 4, step: 0.05, default: 1 },
          { key: 'instructions', label: 'Voice instructions', type: 'text', placeholder: 'e.g. Speak in a calm, professional tone' },
        ],
        defaultConfig: { model: 'gpt-4o-mini-tts', voice: 'alloy', speed: 1, instructions: '' },
        async synthesize(text, opts) {
          if (!opts.apiKey) throw new Error('Falta API key de OpenAI TTS. Pégala en Ajustes → Voz.')
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
      const sttModels = [
        { value: 'whisper-1', label: 'Whisper-1 — recommended' },
        { value: 'gpt-4o-transcribe', label: 'GPT-4o Transcribe — latest' },
        { value: 'gpt-4o-mini-transcribe', label: 'GPT-4o mini Transcribe — fast' },
      ]
      const stt = {
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
          { key: 'model', label: 'Model', type: 'select', options: sttModels, default: 'whisper-1' },
          { key: 'language', label: 'Language (optional)', type: 'text', placeholder: 'es, en, auto...' },
          { key: 'prompt', label: 'Prompt hint', type: 'text', placeholder: 'cerrajería, programación, VIN, inmovilizador...' },
        ],
        defaultConfig: { model: 'whisper-1', language: '', prompt: '' },
        async transcribe(audioBlob, opts) {
          if (!opts.apiKey) throw new Error('Falta API key de OpenAI Whisper. Pégala en Ajustes → Voz. La clave DEEPSEEK de Modelos no sirve para STT.')
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
      registerProvider(tts)
      registerProvider(stt)
    }

    // Microsoft Edge — Read Aloud endpoint (no key).
    {
      const edgeVoices = [
        { value: 'es-ES-ElviraNeural', label: 'Español — Elvira (mujer)' },
        { value: 'es-ES-AlvaroNeural', label: 'Español — Álvaro (hombre)' },
        { value: 'es-MX-DaliaNeural', label: 'Español México — Dalia (mujer)' },
        { value: 'es-MX-JorgeNeural', label: 'Español México — Jorge (hombre)' },
        { value: 'es-AR-ElenaNeural', label: 'Español Argentina — Elena' },
        { value: 'en-US-AriaNeural', label: 'English US — Aria (mujer)' },
        { value: 'en-US-GuyNeural', label: 'English US — Guy (hombre)' },
        { value: 'en-GB-RyanNeural', label: 'English UK — Ryan (hombre)' },
        { value: 'pt-BR-FranciscaNeural', label: 'Português Brasil — Francisca' },
        { value: 'zh-CN-XiaoxiaoNeural', label: '中文 — Xiaoxiao' },
      ]
      function escapeXml(s) {
        return String(s)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&apos;')
      }
      const edge = {
        id: 'edge-tts',
        kind: 'tts',
        label: 'Microsoft Edge (online)',
        capabilities: {
          languages: '80+ neural voices',
          requiresKey: false,
          offline: false,
          costPer1kChars: 0,
          privacyNote: 'Audio is generated by Microsoft edge servers.',
        },
        configSchema: [
          { key: 'voice', label: 'Voice', type: 'select', options: edgeVoices, default: 'es-ES-ElviraNeural' },
          {
            key: 'rate',
            label: 'Speed',
            type: 'select',
            options: [
              { value: '-0.5', label: 'Más lento' },
              { value: '0', label: 'Normal' },
              { value: '0.5', label: 'Más rápido' },
              { value: '1', label: 'Muy rápido' },
            ],
            default: '0',
          },
          {
            key: 'pitch',
            label: 'Pitch',
            type: 'select',
            options: [
              { value: '-50Hz', label: 'Grave' },
              { value: '0Hz', label: 'Normal' },
              { value: '50Hz', label: 'Agudo' },
            ],
            default: '0Hz',
          },
        ],
        defaultConfig: { voice: 'es-ES-ElviraNeural', rate: '0', pitch: '0Hz' },
        async synthesize(text, opts) {
          const ssml = [
            '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="',
            String(opts.voice || '').split('-').slice(0, 2).join('-'),
            '"><voice name="',
            String(opts.voice || ''),
            '"><prosody rate="',
            String(opts.rate == null ? '0' : opts.rate),
            '" pitch="',
            String(opts.pitch == null ? '0Hz' : opts.pitch),
            '">',
            escapeXml(text),
            '</prosody></voice></speak>',
          ].join('')
          const res = await fetch('https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?trustedclient=true', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/ssml+xml',
              'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
              Origin: 'https://www.bing.com',
              Referer: 'https://www.bing.com/',
            },
            body: ssml,
          })
          if (!res.ok) throw new Error(`Edge TTS ${res.status}`)
          const blob = await res.blob()
          return { kind: 'blob', blob, mimeType: 'audio/mpeg' }
        },
      }
      registerProvider(edge)
    }

    // ElevenLabs TTS (registry stub — wired when the user adds an API key).
    {
      const eleven = {
        id: 'elevenlabs-tts',
        kind: 'tts',
        label: 'ElevenLabs (premium)',
        capabilities: {
          languages: '29 languages',
          requiresKey: true,
          offline: false,
          costPer1kChars: 0.18,
          privacyNote: 'Audio bytes leave the device.',
        },
        configSchema: [
          { key: 'apiKey', label: 'API Key', type: 'secret' },
          { key: 'voiceId', label: 'Voice ID', type: 'text', placeholder: 'elevenlabs voice ID' },
          {
            key: 'model', label: 'Model', type: 'select', default: 'eleven_multilingual_v2',
            options: [
              { value: 'eleven_multilingual_v2', label: 'Multilingual v2 (recommended)' },
              { value: 'eleven_turbo_v2_5', label: 'Turbo v2.5 (low latency)' },
              { value: 'eleven_flash_v2_5', label: 'Flash v2.5 (fastest)' },
            ],
          },
          { key: 'stability', label: 'Stability', type: 'range', min: 0, max: 1, step: 0.05, default: 0.5 },
          { key: 'similarityBoost', label: 'Clarity', type: 'range', min: 0, max: 1, step: 0.05, default: 0.75 },
        ],
        defaultConfig: { model: 'eleven_multilingual_v2', stability: 0.5, similarityBoost: 0.75 },
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
      registerProvider(eleven)
    }

    // Deepgram STT (Nova-3).
    {

    // Local Whisper (mlx_whisper / whisper CLI) — host Cordis route, on-device.
    {
      const LOCAL_TRANSCRIBE_PATH = '/api/abaco-voice.local-transcribe'
      const LOCAL_STATUS_PATH = '/api/abaco-voice.local-status'
      const localModels = [
        { value: 'mlx-community/whisper-small-mlx', label: 'Small-MLX — default' },
        { value: 'mlx-community/whisper-base-mlx', label: 'Base-MLX' },
        { value: 'mlx-community/whisper-tiny-mlx', label: 'Tiny-MLX' },
        { value: 'mlx-community/whisper-tiny', label: 'Tiny' },
      ]
      const localWhisper = {
        id: 'local-whisper-stt',
        kind: 'stt',
        label: 'Whisper local (macOS)',
        capabilities: {
          languages: '99+ (modelo local)',
          requiresKey: false,
          offline: true,
          costPerMinute: 0,
          privacyNote: 'Audio stays on this Mac (mlx_whisper / whisper + ffmpeg).',
        },
        configSchema: [
          { key: 'model', label: 'Model', type: 'select', options: localModels, default: 'mlx-community/whisper-small-mlx' },
          { key: 'language', label: 'Language', type: 'text', placeholder: 'es, en, …' },
        ],
        defaultConfig: { model: 'mlx-community/whisper-small-mlx', language: 'es' },
        async transcribe(audioBlob, opts) {
          const model = resolveLocalWhisperModel((opts && opts.model) || DEFAULT_LOCAL_MODEL)
          const language = (opts && opts.language) || DEFAULT_LOCAL_LANGUAGE || 'es'
          const q = new URLSearchParams({
            filename: 'audio.webm',
            model: String(model),
            language: String(language),
          })
          const res = await fetch(
            `${window.location.origin}${LOCAL_TRANSCRIBE_PATH}?${q}`,
            {
              method: 'POST',
              headers: { 'content-type': audioBlob.type || 'audio/webm' },
              body: audioBlob,
            },
          )
          let payload = null
          try { payload = await res.json() } catch {}
          if (!res.ok || !payload || payload.ok !== true) {
            throw new Error(
              (payload && payload.error) ||
              `Whisper local falló (HTTP ${res.status}). Instala mlx-whisper + ffmpeg y reinicia la app.`,
            )
          }
          return {
            text: payload.text || '',
            language,
            segments: [],
            duration: undefined,
            meta: payload.meta || { offline: true },
          }
        },
      }
      localWhisper.__statusPath = LOCAL_STATUS_PATH
      registerProvider(localWhisper)
    }

      const deepgram = {
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
          {
            key: 'model', label: 'Model', type: 'select', default: 'nova-3',
            options: [
              { value: 'nova-3', label: 'Nova-3 (latest, recommended)' },
              { value: 'nova-2', label: 'Nova-2' },
              { value: 'whisper-large', label: 'Whisper Large (Deepgram-hosted)' },
            ],
          },
          {
            key: 'language', label: 'Language', type: 'select', default: 'multi',
            options: [
              { value: 'es', label: 'Español' },
              { value: 'en', label: 'English' },
              { value: 'pt', label: 'Português' },
              { value: 'zh', label: '中文' },
              { value: 'multi', label: 'Multi-language (auto)' },
            ],
          },
          { key: 'smartFormat', label: 'Smart formatting', type: 'boolean', default: true },
          { key: 'keywords', label: 'Vocabulary hints', type: 'text', placeholder: 'cerrajería:5, VIN:4, inmovilizador:3, BMW:2, FEM:3, CAS:3' },
        ],
        defaultConfig: { model: 'nova-3', language: 'multi', smartFormat: true, keywords: '' },
        async transcribe(audioBlob, opts) {
          if (!opts.apiKey) throw new Error('Deepgram API key required')
          const params = new URLSearchParams({
            model: opts.model,
            smart_format: String(opts.smartFormat == null ? true : opts.smartFormat),
          })
          if (opts.language && opts.language !== 'multi') params.set('language', opts.language)
          if (opts.keywords) {
            for (const kw of String(opts.keywords).split(',').map((s) => s.trim()).filter(Boolean)) {
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
          const alt = (json && json.results && json.results.channels && json.results.channels[0] && json.results.channels[0].alternatives && json.results.channels[0].alternatives[0]) || {}
          return {
            text: alt.transcript || '',
            language: (json && json.results && json.results.detected_language) || opts.language,
            segments: alt.words || [],
            duration: json && json.metadata && json.metadata.duration,
          }
        },
      }
      registerProvider(deepgram)
    }

    // ══════════════════════════════════════════════════════════════════════
    // UI
    // ══════════════════════════════════════════════════════════════════════

    let abacoCtx = null

    // NOTE: never read properties off the Cordis `ctx` proxy (including
    // window.__abaco_ctx if it still points at one). Accessing undeclared
    // keys throws "cannot get property … without inject" and kills the
    // composer. Voice config persists only through this plain shim / bag.
    function resolveStore() {
      const bag = typeof window !== 'undefined' ? window.__abaco_voice_store : null
      if (bag && typeof bag.get === 'function' && typeof bag.set === 'function') return bag
      const KEY = 'abaco-voice:fallback-store'
      let cache = null
      const read = () => {
        if (cache) return cache
        try { cache = JSON.parse(window.localStorage.getItem(KEY) || '{}') } catch { cache = {} }
        return cache
      }
      const persist = () => {
        try { window.localStorage.setItem(KEY, JSON.stringify(cache || {})) } catch {}
      }
      const shim = {
        async get(k) { return read()[k] != null ? read()[k] : null },
        async set(k, v) { read()[k] = v; persist() },
        async delete(k) { delete read()[k]; persist() },
      }
      if (typeof window !== 'undefined') window.__abaco_voice_store = shim
      return shim
    }

    async function ensureDisclosureAccepted(provider) {
      const cap = provider && provider.capabilities || {}
      if (cap.offline === true || cap.offline === 'partial') return // local-only
      const store = resolveStore()
      const cfg = await loadConfig(store)
      if (cfg.privacy && cfg.privacy.disclosureAccepted) return
      const ok = window.confirm(
        `Activar ${provider.label}?\n\n` +
        `Tu audio será enviado a ${String(provider.label).includes('OpenAI') ? 'OpenAI' : 'un servicio externo'} para transcripción/síntesis. ` +
        `No se almacena en nuestros servidores, pero sale de tu Mac.\n\n` +
        `Si prefieres privacidad total, usa "Web Speech (browser)" — corre local sin enviar audio a ningún lado.\n\n` +
        `¿Continuar?`,
      )
      if (!ok) throw new Error('Disclosure not accepted')
      cfg.privacy = cfg.privacy || {}
      cfg.privacy.disclosureAccepted = true
      cfg.privacy.disclosureAcceptedAt = new Date().toISOString()
      await saveConfig(store, cfg)
    }

    // Read the live draft through the standard session props when available.
    function currentDraft(props) {
      const useInput = props && props.useInput
      if (typeof useInput !== 'function') return ''
      try {
        const value = useInput((s) => (s && s.draft) || '')
        return value || ''
      } catch {
        return ''
      }
    }

    // ── Mic button (composer left accessory) ─────────────────────────────

    function speechRecognitionAvailable() {
      return typeof window !== 'undefined' &&
        !!(window.SpeechRecognition || window.webkitSpeechRecognition)
    }

    function isLiveSttProvider(provider) {
      if (!provider) return false
      // Electron has no SpeechRecognition — never take the live path there.
      if (!speechRecognitionAvailable()) return false
      if (provider.id === 'web-speech-stt') return true
      return !!(provider.capabilities && provider.capabilities.live)
    }

    function providerConfigOf(cfg, providerId) {
      if (!cfg || !cfg.providers || !providerId) return {}
      return cfg.providers[providerId] || {}
    }

    function providerHasApiKey(cfg, provider) {
      if (!provider) return false
      const needs = !!(provider.capabilities && provider.capabilities.requiresKey)
      if (!needs) return true
      const key = providerConfigOf(cfg, provider.id).apiKey
      return typeof key === 'string' && key.trim().length > 0
    }

    /** Spanish gate: Electron blob STT needs OpenAI/Deepgram key (DEEPSEEK model key ≠ Whisper). */
    function missingSttKeyError(provider) {
      const label = provider && provider.label ? provider.label : 'OpenAI Whisper / Deepgram'
      return (
        `Falta API key de ${label}. ` +
        'Pégala en Ajustes → Voz (providers). ' +
        'La clave DEEPSEEK de Modelos no sirve para STT.'
      )
    }

    function pickBlobSttProvider(cfg) {
      const preferred = ['local-whisper-stt', 'openai-stt', 'deepgram-stt', 'deepgram']
      const ordered = []
      if (cfg && cfg.sttProvider) ordered.push(cfg.sttProvider)
      for (const id of preferred) if (!ordered.includes(id)) ordered.push(id)
      let firstCapable = null
      for (const id of ordered) {
        const p = getProvider(id)
        if (!p || typeof p.transcribe !== 'function') continue
        if (p.id === 'web-speech-stt') continue
        if (!firstCapable) firstCapable = p
        if (providerHasApiKey(cfg, p)) return p
      }
      return firstCapable
    }

    function assertBlobSttReady(cfg, provider) {
      if (!provider || typeof provider.transcribe !== 'function') {
        throw new Error(
          'SpeechRecognition no existe en Electron. Usa «Whisper local (macOS)» ' +
          '(mlx_whisper + ffmpeg) o configura OpenAI/Deepgram en Ajustes → Voz.',
        )
      }
      if (!providerHasApiKey(cfg, provider)) {
        throw new Error(missingSttKeyError(provider))
      }
    }

    function MicButton({ onInsert }) {
      const [state, setState] = React.useState('idle') // idle | recording | transcribing | error
      const [error, setError] = React.useState(null)
      const [duration, setDuration] = React.useState(0)
      const timerRef = React.useRef(null)
      const liveRecRef = React.useRef(null)
      const liveTextRef = React.useRef('')
      const liveModeRef = React.useRef(false)

      React.useEffect(() => () => {
        if (timerRef.current) clearInterval(timerRef.current)
        if (liveRecRef.current) {
          try { liveRecRef.current.abort() } catch {}
          try { liveRecRef.current.stop() } catch {}
          liveRecRef.current = null
        }
      }, [])

      const stopLiveRecognition = () => new Promise((resolve) => {
        const rec = liveRecRef.current
        if (!rec) {
          resolve(liveTextRef.current.trim())
          return
        }
        let settled = false
        const finish = () => {
          if (settled) return
          settled = true
          liveRecRef.current = null
          resolve(liveTextRef.current.trim())
        }
        const prevEnd = rec.onend
        rec.onend = (ev) => {
          try { if (typeof prevEnd === 'function') prevEnd(ev) } catch {}
          finish()
        }
        try { rec.stop() } catch { finish() }
        setTimeout(finish, 1500)
      })

      const onClick = async () => {
        setError(null)
        try {
          if (state === 'recording') {
            setState('transcribing')
            clearInterval(timerRef.current)
            setDuration(0)
            if (liveModeRef.current) {
              const textOut = await stopLiveRecognition()
              liveModeRef.current = false
              if (textOut) onInsert(textOut)
              else {
                setError('No se capturó texto. Habla mientras el mic está activo, o usa OpenAI/Deepgram.')
                setState('error')
                return
              }
              setState('idle')
              return
            }
            const stopped = await recorderStop()
            if (stopped) await transcribeBlob(stopped.blob)
            setState('idle')
            return
          }
          const store = resolveStore()
          const cfg = await loadConfig(store)
          let provider = getProvider(cfg.sttProvider)
          if (!provider) throw new Error('STT provider not configured')

          // Electron: skip live SpeechRecognition; force MediaRecorder + cloud STT.
          if (!isLiveSttProvider(provider)) {
            const blobProvider = provider.id === 'web-speech-stt'
              ? pickBlobSttProvider(cfg)
              : (typeof provider.transcribe === 'function' ? provider : pickBlobSttProvider(cfg))
            if (!blobProvider) {
              throw new Error(
                'SpeechRecognition no existe en Electron. Configura OpenAI Whisper o Deepgram ' +
                'en Ajustes → Voz (API key) para transcribir con MediaRecorder.',
              )
            }
            provider = blobProvider
          }

          await ensureDisclosureAccepted(provider)
          const provCfg = cfg.providers[provider.id] || {}

          if (isLiveSttProvider(provider) && typeof provider.createRecognizer === 'function') {
            liveTextRef.current = ''
            liveModeRef.current = true
            const rec = provider.createRecognizer(provCfg)
            rec.onresult = (e) => {
              for (let i = e.resultIndex; i < e.results.length; i++) {
                const piece = e.results[i][0] && e.results[i][0].transcript ? e.results[i][0].transcript : ''
                if (e.results[i].isFinal) liveTextRef.current += piece + ' '
              }
            }
            rec.onerror = (e) => {
              const msg = e && e.error ? e.error : 'desconocido'
              if (msg === 'aborted' || msg === 'no-speech') return
              setError(`SpeechRecognition error: ${msg}`)
              setState('error')
            }
            liveRecRef.current = rec
            rec.start()
            setState('recording')
            setDuration(0)
            timerRef.current = setInterval(() => setDuration((d) => d + 0.1), 100)
            return
          }

          // MediaRecorder → provider.transcribe(blob) → setDraft (+ submit)
          liveModeRef.current = false
          assertBlobSttReady(cfg, provider)
          // Remember which blob provider to use on stop (may differ from saved cfg).
          liveRecRef.current = { __blobProviderId: provider.id }
          await recorderStart()
          setState('recording')
          setDuration(0)
          timerRef.current = setInterval(() => setDuration((d) => d + 0.1), 100)
        } catch (e) {
          liveModeRef.current = false
          liveRecRef.current = null
          setError(e && e.message ? e.message : String(e))
          setState('error')
        }
      }

      async function transcribeBlob(blob) {
        const store = resolveStore()
        const cfg = await loadConfig(store)
        const forcedId = liveRecRef.current && liveRecRef.current.__blobProviderId
        liveRecRef.current = null
        let provider = forcedId ? getProvider(forcedId) : getProvider(cfg.sttProvider)
        if (!provider || typeof provider.transcribe !== 'function') {
          provider = pickBlobSttProvider(cfg)
        }
        if (!provider) throw new Error('STT provider not configured')
        const provCfg = cfg.providers[provider.id] || {}
        try {
          const result = await provider.transcribe(blob, provCfg)
          if (result && result.text) onInsert(result.text)
          else {
            const isLocal = provider && provider.id === 'local-whisper-stt'
            setError(
              isLocal
                ? 'Whisper local: transcripción vacía (sin voz detectada o modelo inválido). Habla cerca del micrófono; usa small-mlx / base-mlx en cache. No es API key.'
                : 'Transcripción vacía — revisa API key / audio.',
            )
            setState('error')
          }
        } catch (e) {
          setError(e && e.message ? e.message : String(e))
          setState('error')
        }
      }

      const onCancel = () => {
        clearInterval(timerRef.current)
        if (liveModeRef.current && liveRecRef.current) {
          try { liveRecRef.current.abort() } catch {}
          try { liveRecRef.current.stop() } catch {}
          liveRecRef.current = null
          liveModeRef.current = false
          liveTextRef.current = ''
        } else {
          recorderCancel()
        }
        setState('idle')
        setDuration(0)
      }

      const styles = {
        idle: { background: 'var(--abaco-bg-2)', color: 'var(--abaco-fg-1)', border: '1px solid var(--abaco-border)' },
        recording: { background: 'var(--abaco-danger)', color: 'white', animation: 'abaco-pulse 1s infinite' },
        transcribing: { background: 'var(--abaco-accent-1)', color: 'var(--abaco-bg-0)' },
        error: { background: 'var(--abaco-warning)', color: 'var(--abaco-bg-0)' },
      }

      const label =
        state === 'recording' ? `◼ ${duration.toFixed(1)}s`
        : state === 'transcribing' ? '…'
        : state === 'error' ? '⚠'
        : '🎙'

      return h(
        'div',
        { style: { display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', maxWidth: 280 } },
        h('button', {
          type: 'button',
          'aria-label': state === 'recording' ? 'Detener grabación' : 'Transcribir voz',
          title: error || (state === 'recording' ? 'Detener' : 'Micrófono'),
          onClick,
          style: {
            width: 32, height: 32, borderRadius: 8, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 500, ...styles[state],
          },
        }, label),
        state === 'recording' && h('button', {
          type: 'button',
          'aria-label': 'Cancelar',
          onClick: onCancel,
          style: {
            width: 24, height: 24, borderRadius: 6, cursor: 'pointer',
            background: 'transparent', color: 'var(--abaco-fg-2)', border: 'none', fontSize: 14,
          },
        }, '×'),
        error && h('span', {
          role: 'alert',
          style: {
            display: 'block', flex: '1 1 100%', fontSize: 11,
            color: 'var(--abaco-danger, #F87171)', lineHeight: 1.3,
          },
        }, error),
      )
    }

    function resolveSetDraft(props) {
      const inputActions = props && props.inputActions
      if (inputActions && typeof inputActions.setDraft === 'function') {
        return { setDraft: inputActions.setDraft.bind(inputActions), actions: inputActions, source: 'inputActions.setDraft' }
      }
      if (props && typeof props.setDraft === 'function') {
        return { setDraft: props.setDraft, actions: inputActions || null, source: 'props.setDraft' }
      }
      if (props && props.input && typeof props.input.setDraft === 'function') {
        return { setDraft: props.input.setDraft.bind(props.input), actions: inputActions || null, source: 'input.setDraft' }
      }
      const win = typeof window !== 'undefined' ? window : null
      // Plain bag only — never win.__abaco_ctx.* (Cordis proxy → without inject).
      const bridge = win && win.__abaco_inputActions
      if (bridge && typeof bridge.setDraft === 'function') {
        return { setDraft: bridge.setDraft.bind(bridge), actions: bridge, source: 'window.__abaco_inputActions' }
      }
      return null
    }

    function AbacoMicButton(props) {
      const draft = currentDraft(props)
      const draftRef = React.useRef(draft)
      draftRef.current = draft
      const [writeError, setWriteError] = React.useState(null)

      React.useEffect(() => {
        const actions = props && props.inputActions
        if (actions && typeof actions.setDraft === 'function' && typeof window !== 'undefined') {
          window.__abaco_inputActions = actions
        }
      }, [props && props.inputActions])

      const onInsert = (text) => {
        setWriteError(null)
        const trimmed = String(text || '').trim()
        if (!trimmed) return
        const resolved = resolveSetDraft(props)
        if (!resolved) {
          const msg = 'No se puede escribir en el borrador: setDraft no disponible (inputActions ausente).'
          setWriteError(msg)
          console.error('abaco-voice:', msg)
          return
        }
        const current = draftRef.current || ''
        const next = current ? `${current} ${trimmed}` : trimmed
        try {
          resolved.setDraft(next)
        } catch (e) {
          const msg = e && e.message ? e.message : String(e)
          setWriteError(`setDraft falló (${resolved.source}): ${msg}`)
          return
        }
        // mic submit: call submit/send when the composer exposes it; else setDraft is enough.
        const actions = resolved.actions
        if (actions) {
          if (typeof actions.submit === 'function') {
            try { actions.submit() } catch (e) { console.warn('abaco-voice mic submit failed:', e) }
          } else if (typeof actions.send === 'function') {
            try { actions.send() } catch (e) { console.warn('abaco-voice mic send failed:', e) }
          }
        }
      }

      return h(
        'div',
        { style: { display: 'inline-flex', flexDirection: 'column', gap: 2 } },
        h(MicButton, { onInsert }),
        writeError && h('span', {
          role: 'alert',
          style: { fontSize: 11, color: 'var(--abaco-danger, #F87171)', maxWidth: 220, lineHeight: 1.3 },
        }, writeError),
      )
    }

    // ── Speak button (per assistant message) ─────────────────────────────

    // Collect the visible prose of a finalized assistant message from the
    // Chat snapshot (the same data the shipped TurnTail renders). Session-scope
    // slot occupants receive the `useChat` selector hook as a standard prop.
    // Verified path: ChatSnapshot.legacy.nodes holds every finalized
    // AssistantMessageNode ({ kind:'assistant', messageId, blocks }) of the
    // loaded window — cf. dsh-client-ui-chat lib/types/client/contract/snapshot.d.ts.
    function collectMessageText(snapshot, messageId) {
      if (!snapshot || !messageId) return ''
      const legacy = snapshot.legacy
      if (legacy && Array.isArray(legacy.nodes)) {
        for (const node of legacy.nodes) {
          if (node && node.kind === 'assistant' && (node.messageId || (node.message && node.message.id)) === messageId) {
            const blocks = node.blocks || (node.message && node.message.blocks) || []
            return blocks
              .filter((b) => b && b.kind === 'text' && typeof b.text === 'string')
              .map((b) => b.text)
              .join('')
          }
        }
      }
      // Fallback: walk the keyed node store (per-node closing data).
      const nodes = snapshot.nodes && typeof snapshot.nodes.values === 'function' ? snapshot.nodes.values() : []
      for (const node of nodes || []) {
        const closing = node && node.data && node.data.closing
        if (!closing) continue
        const finalNode = closing.finalNode || closing.message || {}
        if ((finalNode.messageId || finalNode.id) === messageId) {
          const blocks = closing.blocks || []
          return blocks
            .filter((b) => b && b.kind === 'text' && typeof b.text === 'string')
            .map((b) => b.text)
            .join('')
        }
      }
      return ''
    }

    function SpeakButton({ text }) {
      const [state, setState] = React.useState('idle')
      if (!text) return null

      const onClick = async () => {
        try {
          if (state === 'speaking') {
            playbackStop()
            setState('idle')
            return
          }
          const store = resolveStore()
          const cfg = await loadConfig(store)
          const provider = getProvider(cfg.ttsProvider)
          if (!provider) throw new Error('TTS provider not configured')
          await ensureDisclosureAccepted(provider)
          const provCfg = cfg.providers[provider.id] || {}
          const audio = await provider.synthesize(text, provCfg)
          setState('speaking')
          await playbackPlay(audio)
          setState('idle')
        } catch (e) {
          console.error('abaco-voice speak failed:', e)
          setState('error')
          setTimeout(() => setState('idle'), 2000)
        }
      }

      return h('button', {
        type: 'button',
        'aria-label': state === 'speaking' ? 'Detener' : 'Leer en voz alta',
        title: state === 'speaking' ? 'Detener' : 'Leer en voz alta',
        onClick,
        style: {
          width: 24, height: 24, borderRadius: 6, cursor: 'pointer',
          background: state === 'speaking' ? 'var(--abaco-accent-1)' : 'transparent',
          color: state === 'speaking' ? 'var(--abaco-bg-0)' : 'var(--abaco-fg-2)',
          border: 'none', fontSize: 13,
        },
      }, state === 'speaking' ? '◼' : state === 'error' ? '⚠' : '🔊')
    }

    function AbacoSpeakButton(props) {
      const messageId = props && props.messageId
      if (!messageId) return null
      return h(SpeakTextProbe, { useChat: props && props.useChat, messageId })
    }

    // Reads the assistant prose through the standard session `useChat` hook.
    // The component only mounts inside an active chat binding, so `useChat`
    // presence is stable across renders.
    function SpeakTextProbe({ useChat, messageId }) {
      let text = ''
      if (messageId && typeof useChat === 'function') {
        try {
          text = useChat((chat) => collectMessageText(chat, messageId)) || ''
        } catch {}
      }
      return h(SpeakButton, { text })
    }

    // ── Settings page ────────────────────────────────────────────────────

    function SettingsPanel() {
      const [config, setConfig] = React.useState(null)
      const [ttsProviders, setTtsProviders] = React.useState([])
      const [sttProviders, setSttProviders] = React.useState([])

      React.useEffect(() => {
        (async () => {
          setConfig(await loadConfig(resolveStore()))
          setTtsProviders(listProviders('tts'))
          setSttProviders(listProviders('stt'))
        })()
      }, [])

      if (!config) return h('div', null, 'Cargando…')

      const update = async (patch) => {
        const next = { ...config, ...patch }
        setConfig(next)
        await saveConfig(resolveStore(), next)
      }

      const updateProvider = async (providerId, partial) => {
        const next = await setProviderConfig(resolveStore(), providerId, partial)
        setConfig((c) => ({ ...c, providers: { ...c.providers, [providerId]: next } }))
      }

      const renderProviderForm = (provider) => {
        const provCfg = config.providers[provider.id] || {}
        return h(
          'div',
          { style: { padding: 12, marginTop: 8, background: 'var(--abaco-bg-1)', borderRadius: 8 } },
          ...provider.configSchema.map((field) =>
            renderField(field, provCfg[field.key] != null ? provCfg[field.key] : (field.default != null ? field.default : ''), (v) => updateProvider(provider.id, { [field.key]: v })),
          ),
        )
      }

      const renderField = (field, value, onChange) => {
        if (field.type === 'secret') {
          return h('div', { key: field.key, style: { marginBottom: 8 } },
            h('label', { style: { display: 'block', fontSize: 12, color: 'var(--abaco-fg-1)', marginBottom: 4 } }, field.label),
            h('input', {
              type: 'password', value, onChange: (e) => onChange(e.target.value),
              placeholder: field.placeholder || '••••••',
              style: {
                width: '100%', padding: '6px 8px', background: 'var(--abaco-bg-2)',
                border: '1px solid var(--abaco-border)', borderRadius: 6,
                color: 'var(--abaco-fg-0)', fontSize: 13, fontFamily: 'SF Mono, monospace',
              },
            }),
          )
        }
        if (field.type === 'select') {
          const opts = field.options === 'voices' ? [] : field.options || []
          return h('div', { key: field.key, style: { marginBottom: 8 } },
            h('label', { style: { display: 'block', fontSize: 12, color: 'var(--abaco-fg-1)', marginBottom: 4 } }, field.label),
            h('select', {
              value, onChange: (e) => onChange(e.target.value),
              style: {
                width: '100%', padding: '6px 8px', background: 'var(--abaco-bg-2)',
                border: '1px solid var(--abaco-border)', borderRadius: 6,
                color: 'var(--abaco-fg-0)', fontSize: 13,
              },
            }, ...opts.map((o) => h('option', { key: o.value, value: o.value }, o.label))),
          )
        }
        if (field.type === 'range') {
          return h('div', { key: field.key, style: { marginBottom: 8 } },
            h('label', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--abaco-fg-1)', marginBottom: 4 } },
              h('span', null, field.label),
              h('span', { style: { fontFamily: 'SF Mono, monospace' } }, String(value)),
            ),
            h('input', {
              type: 'range', min: field.min, max: field.max, step: field.step, value, onChange: (e) => onChange(Number(e.target.value)),
              style: { width: '100%' },
            }),
          )
        }
        if (field.type === 'boolean') {
          return h('label', { key: field.key, style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 13, color: 'var(--abaco-fg-1)' } },
            h('input', { type: 'checkbox', checked: !!value, onChange: (e) => onChange(e.target.checked) }),
            field.label,
          )
        }
        return h('div', { key: field.key, style: { marginBottom: 8 } },
          h('label', { style: { display: 'block', fontSize: 12, color: 'var(--abaco-fg-1)', marginBottom: 4 } }, field.label),
          h('input', {
            type: 'text', value, onChange: (e) => onChange(e.target.value),
            placeholder: field.placeholder || '',
            style: {
              width: '100%', padding: '6px 8px', background: 'var(--abaco-bg-2)',
              border: '1px solid var(--abaco-border)', borderRadius: 6,
              color: 'var(--abaco-fg-0)', fontSize: 13,
            },
          }),
        )
      }

      const ttsSelected = getProvider(config.ttsProvider)
      const sttSelected = getProvider(config.sttProvider)

      const providerOption = (p) =>
        `${p.label}${p.capabilities.requiresKey ? ' 🔑' : ''}${p.capabilities.offline === true || p.capabilities.offline === 'partial' ? ' 🛡 local' : ''}`

      return h(
        'div',
        { style: { padding: 16, fontSize: 14, color: 'var(--abaco-fg-0)' } },
        h('h3', { style: { margin: '0 0 12px', fontSize: 16, fontWeight: 600 } }, 'Voz — Text-to-speech'),
        h('label', { style: { display: 'block', fontSize: 12, color: 'var(--abaco-fg-1)', marginBottom: 4 } }, 'Proveedor'),
        h('select', {
          value: config.ttsProvider, onChange: (e) => update({ ttsProvider: e.target.value }),
          style: {
            width: '100%', padding: '8px 10px', background: 'var(--abaco-bg-1)',
            border: '1px solid var(--abaco-border)', borderRadius: 6,
            color: 'var(--abaco-fg-0)', fontSize: 14,
          },
        }, ...ttsProviders.map((p) => h('option', { key: p.id, value: p.id }, providerOption(p)))),
        ttsSelected && renderProviderForm(ttsSelected),
        ttsSelected && ttsSelected.capabilities.privacyNote && h(
          'div', { style: { marginTop: 6, fontSize: 11, color: 'var(--abaco-warning)' } },
          '⚠ ', ttsSelected.capabilities.privacyNote,
        ),

        h('h3', { style: { margin: '24px 0 12px', fontSize: 16, fontWeight: 600 } }, 'Voz — Speech-to-text'),
        h('label', { style: { display: 'block', fontSize: 12, color: 'var(--abaco-fg-1)', marginBottom: 4 } }, 'Proveedor'),
        h('select', {
          value: config.sttProvider, onChange: (e) => update({ sttProvider: e.target.value }),
          style: {
            width: '100%', padding: '8px 10px', background: 'var(--abaco-bg-1)',
            border: '1px solid var(--abaco-border)', borderRadius: 6,
            color: 'var(--abaco-fg-0)', fontSize: 14,
          },
        }, ...sttProviders.map((p) => h('option', { key: p.id, value: p.id }, providerOption(p)))),
        sttSelected && renderProviderForm(sttSelected),
        sttSelected && sttSelected.capabilities.privacyNote && h(
          'div', { style: { marginTop: 6, fontSize: 11, color: 'var(--abaco-warning)' } },
          '⚠ ', sttSelected.capabilities.privacyNote,
        ),

        h('h3', { style: { margin: '24px 0 12px', fontSize: 16, fontWeight: 600 } }, 'Privacidad'),
        h('label', { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--abaco-fg-1)' } },
          h('input', { type: 'checkbox', checked: !!(config.privacy && config.privacy.disclosureAccepted), disabled: true, onChange: () => {} }),
          h('span', null,
            'Disclosure aceptado',
            config.privacy && config.privacy.disclosureAcceptedAt && h('span',
              { style: { marginLeft: 6, color: 'var(--abaco-fg-2)', fontSize: 11 } },
              `(${new Date(config.privacy.disclosureAcceptedAt).toLocaleDateString()})`,
            ),
          ),
        ),
        h('button', {
          type: 'button', onClick: async () => {
            const next = { ...config, privacy: { ...(config.privacy || {}), disclosureAccepted: false, disclosureAcceptedAt: null } }
            await saveConfig(resolveStore(), next)
            setConfig(next)
          },
          style: {
            marginTop: 8, padding: '4px 10px', background: 'transparent',
            border: '1px solid var(--abaco-border)', borderRadius: 6,
            color: 'var(--abaco-fg-1)', fontSize: 11, cursor: 'pointer',
          },
        }, 'Reset disclosure'),
      )
    }

    // ── Slot injection ───────────────────────────────────────────────────

    const inject = ['slots']

    function apply(ctx) {
      // Keep a handle for tests only — never expose the Cordis proxy on window
      // (reading .store / .inputActions throws "without inject" in the composer).
      abacoCtx = ctx
      if (typeof window !== 'undefined') {
        delete window.__abaco_ctx
        resolveStore()
      }

      // Mic button → conversation.input.left (list / session)
      ctx.slots.inject('conversation.input.left', () =>
        ctx.slots.register(
          { name: 'conversation.input.left', id: 'abaco-voice-mic', order: 10 },
          AbacoMicButton,
        ),
      )

      // Speak button → conversation.chat.assistant-actions (list / session; props { messageId })
      ctx.slots.inject('conversation.chat.assistant-actions', () =>
        ctx.slots.register(
          { name: 'conversation.chat.assistant-actions', id: 'abaco-voice-speak', order: 40 },
          AbacoSpeakButton,
        ),
      )

      // Settings page → settings.section (own page in Settings)
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          { name: 'settings.section', id: 'abaco-voice', order: 60, label: 'Voz' },
          SettingsPanel,
        ),
      )

      // Inject styles (pulse keyframe; theme tokens come from abaco-theme)
      if (!document.getElementById('abaco-voice-style')) {
        const s = document.createElement('style')
        s.id = 'abaco-voice-style'
        s.dataset.plugin = 'abaco-voice'
        s.textContent = `
          @keyframes abaco-pulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: .8; transform: scale(1.05); }
          }
        `
        document.head.appendChild(s)
      }
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
