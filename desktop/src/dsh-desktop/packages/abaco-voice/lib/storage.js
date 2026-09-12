/**
 * Settings persistence for abaco-voice.
 *
 * Backed by the abaco-device-identity plugin's secure store (Keychain on
 * macOS). API keys never go into the plain settings.yaml file. Provider
 * selections and non-secret knobs can sync across devices.
 */

import { defaultVoiceConfig, normalizeVoiceConfig } from './normalize-config.js'

const STORE_KEY = 'abaco-voice:config'

export { defaultVoiceConfig, normalizeVoiceConfig }

export async function loadConfig(store) {
  const raw = await store.get(STORE_KEY)
  if (!raw) return defaultVoiceConfig()
  try {
    const parsed = JSON.parse(raw)
    const { config, changed } = normalizeVoiceConfig(parsed)
    if (changed) {
      try { await saveConfig(store, config) } catch {}
    }
    return config
  } catch {
    return defaultVoiceConfig()
  }
}

export async function saveConfig(store, config) {
  await store.set(STORE_KEY, JSON.stringify(config))
}

export async function getProviderConfig(store, providerId) {
  const cfg = await loadConfig(store)
  return cfg.providers[providerId] || {}
}

export async function setProviderConfig(store, providerId, partial) {
  const cfg = await loadConfig(store)
  cfg.providers[providerId] = { ...(cfg.providers[providerId] || {}), ...partial }
  await saveConfig(store, cfg)
  return cfg.providers[providerId]
}
