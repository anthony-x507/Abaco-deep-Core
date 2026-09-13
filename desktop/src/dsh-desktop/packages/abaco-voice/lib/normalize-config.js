/**
 * Normalize abaco-voice STT config (0.4.7).
 * - Schema / DEFAULT / migrate empty → mlx-community/whisper-small-mlx + es
 * - STICKY tiny / tiny-mlx → ALWAYS small-mlx (load/save write-through)
 * - openai-stt / deepgram* without key → local-whisper-stt (write-through)
 * - Exact BAD plain ids → *-mlx; NEVER includes('whisper-base')
 * - Cache probe is runtime-only (pickCachedModel); not the schema default
 * - Tiny remains last-resort cache fallback only when small-mlx AND base-mlx absent
 */

import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const LOCAL_WHISPER_ID = 'local-whisper-stt'
export const OPENAI_STT_ID = 'openai-stt'
export const DEEPGRAM_STT_IDS = ['deepgram-stt', 'deepgram']

/** Schema default — always small-mlx + es (Arq). */
export const DEFAULT_LOCAL_MODEL = 'mlx-community/whisper-small-mlx'
export const DEFAULT_LOCAL_LANGUAGE = 'es'

/** Sticky legacy ids — ALWAYS force-migrate to small-mlx (0.4.7). */
export const STICKY_TINY_LOCAL_MODELS = [
  'mlx-community/whisper-tiny',
  'mlx-community/whisper-tiny-mlx',
  'whisper-tiny',
]

/** Runtime quality preference (cache pick order). Tiny = last resort only. */
export const QUALITY_PREF = [
  'mlx-community/whisper-small-mlx',
  'mlx-community/whisper-base-mlx',
  'mlx-community/whisper-tiny-mlx',
  'mlx-community/whisper-tiny',
]

/** Exact allowlist (cache probe + coerce). No plain base/small. No large-v3-turbo. */
export const KNOWN_GOOD_LOCAL_MODELS = [...QUALITY_PREF]

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
    providers: {
      [LOCAL_WHISPER_ID]: {
        model: DEFAULT_LOCAL_MODEL,
        language: DEFAULT_LOCAL_LANGUAGE,
      },
    },
    privacy: {
      disclosureAccepted: false,
      disclosureAcceptedAt: null,
      rememberTranscriptDays: 0,
    },
  }
}

/**
 * @param {string} modelId
 */
export function hubModelDirName(modelId) {
  return `models--${String(modelId).replace(/\//g, '--')}`
}

export function resolveHubCacheRoot() {
  if (process.env.HUGGINGFACE_HUB_CACHE) return process.env.HUGGINGFACE_HUB_CACHE
  if (process.env.HF_HOME) return join(process.env.HF_HOME, 'hub')
  return join(homedir(), '.cache', 'huggingface', 'hub')
}

/**
 * Fs-only probe. 0 download. Exact allowlist ids only.
 * @param {string} [hubRoot]
 * @returns {Promise<string[]>}
 */
export async function listCachedLocalWhisperModels(hubRoot = resolveHubCacheRoot()) {
  let entries = []
  try {
    entries = await readdir(hubRoot)
  } catch {
    return []
  }
  const entrySet = new Set(entries)
  const found = []
  for (const id of KNOWN_GOOD_LOCAL_MODELS) {
    const dirName = hubModelDirName(id)
    if (!entrySet.has(dirName)) continue
    const modelRoot = join(hubRoot, dirName)
    let ok = false
    try {
      const snaps = await readdir(join(modelRoot, 'snapshots'))
      ok = snaps.length > 0
    } catch {
      try {
        const kids = await readdir(modelRoot)
        ok = kids.length > 0
      } catch {
        ok = false
      }
    }
    if (ok) found.push(id)
  }
  return found
}

/**
 * @param {string[]} cached
 * @returns {string | null}
 */
export function pickCachedModel(cached) {
  const set = new Set(cached || [])
  for (const id of QUALITY_PREF) {
    if (set.has(id)) return id
  }
  return null
}

/**
 * @param {string | undefined | null} model
 */
export function isStickyTinyLocalModel(model) {
  const raw = model != null ? String(model).trim() : ''
  return STICKY_TINY_LOCAL_MODELS.includes(raw)
}

/**
 * Coerce / migrate local whisper model ids.
 * Sticky tiny ALWAYS → small-mlx (cached.includes(tiny) does NOT pardon).
 */
export function resolveLocalWhisperModel(model) {
  const raw = model != null ? String(model).trim() : ''
  if (!raw) return DEFAULT_LOCAL_MODEL
  // 0.4.7: force-migrate sticky tiny before allowlist / BAD map
  if (isStickyTinyLocalModel(raw)) return DEFAULT_LOCAL_MODEL
  if (Object.prototype.hasOwnProperty.call(BAD_LOCAL_MODEL_MAP, raw)) {
    return BAD_LOCAL_MODEL_MAP[raw]
  }
  if (KNOWN_GOOD_LOCAL_MODELS.includes(raw)) return raw
  // Unknown → schema default (small-mlx), never invent plain base/small
  return DEFAULT_LOCAL_MODEL
}

function providerApiKey(providers, id) {
  const key = ((providers || {})[id] || {}).apiKey
  return key != null ? String(key).trim() : ''
}

/**
 * @param {any} raw
 * @param {{ cachedModels?: string[] }} [opts]
 * @returns {{ config: any, changed: boolean }}
 */
export function normalizeVoiceConfig(raw, opts = {}) {
  const base = defaultVoiceConfig()
  const incoming = raw && typeof raw === 'object' ? raw : {}
  const config = {
    ...base,
    ...incoming,
    providers: { ...(incoming.providers || {}) },
    privacy: { ...base.privacy, ...(incoming.privacy || {}) },
  }
  let changed = false

  const requiresKeyIds = [OPENAI_STT_ID, ...DEEPGRAM_STT_IDS]
  if (requiresKeyIds.includes(config.sttProvider)) {
    if (!providerApiKey(config.providers, config.sttProvider)) {
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
  let resolved = resolveLocalWhisperModel(lw.model)

  // Runtime cache awareness (optional): if provided, never leave a model that
  // is not cached when a preferred cached pick exists. Sticky tiny already
  // forced to small-mlx above — cached.includes(tiny) does NOT pardon sticky.
  // Tiny pick only when small-mlx AND base-mlx are both absent from cache.
  if (Array.isArray(opts.cachedModels)) {
    const picked = pickCachedModel(opts.cachedModels)
    if (picked && !opts.cachedModels.includes(resolved)) {
      resolved = picked
    }
  }

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
  } else if (!config.providers[LOCAL_WHISPER_ID]) {
    config.providers[LOCAL_WHISPER_ID] = {
      model: DEFAULT_LOCAL_MODEL,
      language: DEFAULT_LOCAL_LANGUAGE,
    }
    changed = true
  }

  return { config, changed }
}
