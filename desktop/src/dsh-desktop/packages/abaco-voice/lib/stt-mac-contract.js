/**
 * F2.1-C — Mac-only local Whisper STT (product lock).
 *
 * Product path is darwin + local-whisper-stt. Linux §15/16 is a deferred
 * fail-closed hint, not a stack. No silent OpenAI/Deepgram fallback.
 * Janice = runtime; Atena is not in authorize.
 *
 * @module abaco-voice/lib/stt-mac-contract
 */

export const STT_PRODUCT_PLATFORM = 'darwin'
export const LOCAL_WHISPER_PROVIDER_ID = 'local-whisper-stt'
export const CLOUD_STT_PROVIDER_IDS = Object.freeze(['openai-stt', 'deepgram-stt', 'deepgram'])

/**
 * Deferred Linux STT (original Pack C items 15/16).
 * Visible fail-closed copy — not an install recipe, not a cloud nudge.
 */
export const LINUX_STT_HINT_15_16 =
  'STT Linux (F2.1-C §15/16) diferido. Producto = Whisper local en Mac (mlx-whisper/ffmpeg). Sin fallback a OpenAI.'

export function isMacLocalSttPlatform(platform) {
  return String(platform || '') === STT_PRODUCT_PLATFORM
}

export function linuxSttDeferredHint() {
  return LINUX_STT_HINT_15_16
}

/** darwin → null (status keeps hint: null). else fail-closed §15/16. */
export function sttPlatformHint(platform) {
  return isMacLocalSttPlatform(platform) ? null : LINUX_STT_HINT_15_16
}

/**
 * Admit the product STT path. Non-Mac is deny + hint (no stack, no cloud).
 * @param {string} [platform]
 */
export function macLocalSttAdmission(platform) {
  if (isMacLocalSttPlatform(platform)) {
    return { ok: true, hint: null, error: null }
  }
  return { ok: false, hint: LINUX_STT_HINT_15_16, error: LINUX_STT_HINT_15_16 }
}

/**
 * Fail-closed: a local-whisper miss must not silently become cloud STT.
 * @param {string} selectedId
 * @param {string} fallbackId
 */
export function denySilentCloudSttFallback(selectedId, fallbackId) {
  const selected = String(selectedId || '')
  const fallback = String(fallbackId || '')
  if (
    selected === LOCAL_WHISPER_PROVIDER_ID &&
    CLOUD_STT_PROVIDER_IDS.includes(fallback)
  ) {
    return { deny: true, reason: 'silent-cloud-stt-fallback' }
  }
  return { deny: false, reason: null }
}

export function isProductLocalWhisper(providerId) {
  return String(providerId || '') === LOCAL_WHISPER_PROVIDER_ID
}
