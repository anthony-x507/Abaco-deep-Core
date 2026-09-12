/**
 * Normalize abaco-voice STT config.
 * - openai-stt without key → local-whisper-stt (write-through migrate)
 * - default = mlx-community/whisper-tiny + es
 * - BAD plain ids (whisper-base, whisper-small) → *-mlx or tiny
 * - NEVER use includes('whisper-base') — that would kill whisper-base-mlx
 */

export const LOCAL_WHISPER_ID = 'local-whisper-stt'
export const OPENAI_STT_ID = 'openai-stt'
export const DEFAULT_LOCAL_MODEL = 'mlx-community/whisper-tiny'
export const DEFAULT_LOCAL_LANGUAGE = 'es'

/** Cached / known-good mlx model ids */
export const KNOWN_GOOD_LOCAL_MODELS = [
  'mlx-community/whisper-tiny',
  'mlx-community/whisper-tiny-mlx',
  'mlx-community/whisper-base-mlx',
  'mlx-community/whisper-small-mlx',
  'mlx-community/whisper-large-v3-turbo',
]

/**
 * Exact BAD ids (Repo Not Found → exit 0 + empty).
 * Do NOT treat *-mlx variants as bad.
 */
export const BAD_LOCAL_MODEL_MAP = {
  'mlx-community/whisper-base': 'mlx-community/whisper-base-mlx',
  'whisper-base': 'mlx-community/whisper-base-mlx',
  'mlx-community/whisper-small': 'mlx-community/whisper-small-mlx',
  'whisper-small': 'mlx-community/whisper-small-mlx',
}

export function defaultVoiceConfig() {
  return {
    ttsProvider: 'web-speech-tts',
    sttProvider: LOCAL_WHISPER_ID,
    providers: {},
    privacy: {
      disclosureAccepted: false,
      disclosureAcceptedAt: null,
      rememberTranscriptDays: 0,
    },
  }
}

/**
 * @param {string | undefined | null} model
 */
export function resolveLocalWhisperModel(model) {
  const raw = model != null ? String(model).trim() : ''
  if (!raw) return DEFAULT_LOCAL_MODEL
  if (Object.prototype.hasOwnProperty.call(BAD_LOCAL_MODEL_MAP, raw)) {
    return BAD_LOCAL_MODEL_MAP[raw]
  }
  if (KNOWN_GOOD_LOCAL_MODELS.includes(raw)) return raw
  // Unknown → safe tiny (never plain whisper-base)
  return DEFAULT_LOCAL_MODEL
}

/**
 * @param {any} raw
 * @returns {{ config: any, changed: boolean }}
 */
export function normalizeVoiceConfig(raw) {
  const base = defaultVoiceConfig()
  const incoming = raw && typeof raw === 'object' ? raw : {}
  const config = {
    ...base,
    ...incoming,
    providers: { ...(incoming.providers || {}) },
    privacy: { ...base.privacy, ...(incoming.privacy || {}) },
  }
  let changed = false

  if (config.sttProvider === OPENAI_STT_ID) {
    const key = ((config.providers || {})[OPENAI_STT_ID] || {}).apiKey
    if (!key || !String(key).trim()) {
      config.sttProvider = LOCAL_WHISPER_ID
      changed = true
    }
  }

  if (!config.sttProvider || config.sttProvider === 'web-speech-stt') {
    config.sttProvider = LOCAL_WHISPER_ID
    changed = true
  }

  const lwPrev = config.providers[LOCAL_WHISPER_ID] || {}
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
    config.providers[LOCAL_WHISPER_ID] = lw
    changed = true
  }

  return { config, changed }
}
