/**
 * CONTRACT-P0-MIC-BUILTIN-SILENCE-048 + DECODE-SILENCE-049 + NO-SILENCE-GATE-0410 — pure helpers.
 * Prefer built-in Mac mic. Helpers (isSilentPreflight / assertNotSilentFromMeasurement) remain for tests.
 * 0.4.10 live path: assertNotSilentBeforeLocalTranscribe is LOG-ONLY (never throw SILENCE_ERROR_ES).
 */

/** Built-in Mac / internal labels (must NOT also match BT). */
export const BUILTIN_MIC_RE = /macbook|built-?in|internal|macintosh|imac|mac mini/i

/** Bluetooth / AirPods / HFP / headset — never preferred when built-in exists. */
export const BT_MIC_RE = /airpods|bluetooth|hands-?free|\bhfp\b|headset/i

export const SILENCE_MIN_DURATION_S = 0.4
/** Peak abs (and RMS≈0) threshold — below this is treated as silence. */
export const SILENCE_PEAK_ABS_MAX = 0.01
/** Tiny useful blob after ≥0.4s → silence (bytes). */
export const SILENCE_TINY_BLOB_BYTES = 256
export const SILENCE_ERROR_ES = 'Mic silencioso. Usa el micrófono del Mac, no AirPods.'
export const MIC_DEL_MAC_CHIP = 'Mic del Mac'

export function isBuiltinMicLabel(label) {
  const s = String(label || '')
  return BUILTIN_MIC_RE.test(s) && !BT_MIC_RE.test(s)
}

export function isBluetoothMicLabel(label) {
  return BT_MIC_RE.test(String(label || ''))
}

/**
 * Pure device pick for composer mic (R1 / R4).
 * @param {Array<{ deviceId?: string, kind?: string, label?: string }>} devices
 * @returns {{ deviceId: string|null, label: string, reason: 'builtin'|'non-bt'|'default', isBuiltin: boolean }}
 */
export function pickComposerMicDevice(devices) {
  const inputs = (Array.isArray(devices) ? devices : []).filter(
    (d) => d && (!d.kind || d.kind === 'audioinput'),
  )

  const builtin = inputs.find((d) => isBuiltinMicLabel(d.label))
  if (builtin && builtin.deviceId) {
    return {
      deviceId: String(builtin.deviceId),
      label: String(builtin.label || ''),
      reason: 'builtin',
      isBuiltin: true,
    }
  }

  const nonBt = inputs.find(
    (d) => d.deviceId && !isBluetoothMicLabel(d.label),
  )
  if (nonBt) {
    return {
      deviceId: String(nonBt.deviceId),
      label: String(nonBt.label || ''),
      reason: 'non-bt',
      isBuiltin: isBuiltinMicLabel(nonBt.label),
    }
  }

  // Last resort: browser default — omit deviceId in getUserMedia.
  return { deviceId: null, label: '', reason: 'default', isBuiltin: false }
}

/**
 * R4: if the active track looks BT/AirPods but a built-in exists, reject BT.
 */
export function shouldRejectBluetoothTrack(trackLabel, devices) {
  if (!isBluetoothMicLabel(trackLabel)) return false
  const inputs = (Array.isArray(devices) ? devices : []).filter(
    (d) => d && (!d.kind || d.kind === 'audioinput'),
  )
  return inputs.some((d) => isBuiltinMicLabel(d.label))
}

/**
 * Peak + RMS over Float32 PCM samples (−1..1).
 * @param {ArrayLike<number>|Float32Array|null|undefined} samples
 */
export function measureFloat32PeakRms(samples) {
  let peak = 0
  let sumSq = 0
  const n = samples && samples.length ? samples.length : 0
  for (let i = 0; i < n; i++) {
    const v = samples[i]
    const a = v < 0 ? -v : v
    if (a > peak) peak = a
    sumSq += v * v
  }
  return { peak, rms: n ? Math.sqrt(sumSq / n) : 0 }
}

/**
 * R3 silence preflight decision (pure).
 * duration≥0.4s AND (peak abs<0.01 OR rms≈0 OR tiny useful blob).
 *
 * D1 / 0.4.9: decodeFailed → skip energy (peak/rms zeros are untrusted;
 * WebAudio cannot decode webm/opus). Only tiny-blob (<256) blocks.
 */
export function isSilentPreflight({ durationSec, peakAbs, rms, blobSize, decodeFailed } = {}) {
  if (!(Number(durationSec) >= SILENCE_MIN_DURATION_S)) return false
  if (decodeFailed) {
    return typeof blobSize === 'number' && blobSize < SILENCE_TINY_BLOB_BYTES
  }
  if (typeof peakAbs === 'number' && peakAbs < SILENCE_PEAK_ABS_MAX) return true
  if (typeof rms === 'number' && rms < SILENCE_PEAK_ABS_MAX) return true
  if (
    typeof blobSize === 'number' &&
    blobSize > 0 &&
    blobSize < SILENCE_TINY_BLOB_BYTES
  ) {
    return true
  }
  return false
}

/**
 * D1/D1b/D2/D3: throw Mic silencioso only when preflight says silent.
 * decodeFailed must not pass peak/rms (energy skipped).
 */
export function assertNotSilentFromMeasurement({
  durationSec,
  peakAbs,
  rms,
  blobSize,
  decodeFailed,
  deviceLabel,
} = {}) {
  const args = decodeFailed
    ? { durationSec, blobSize, decodeFailed: true }
    : { durationSec, peakAbs, rms, blobSize }
  if (isSilentPreflight(args)) {
    const err = new Error(SILENCE_ERROR_ES)
    err.meta = {
      blobSize: typeof blobSize === 'number' ? blobSize : 0,
      deviceLabel: deviceLabel != null ? String(deviceLabel) : '',
      decodeFailed: !!decodeFailed,
    }
    throw err
  }
}

/**
 * Build audio constraints for composer mic — NEVER includes sampleRate (R2).
 * @param {string|null|undefined} deviceId
 */
export function buildComposerMicAudioConstraints(deviceId) {
  const audio = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  }
  if (deviceId) {
    audio.deviceId = { exact: String(deviceId) }
  }
  return { audio, video: false }
}

/**
 * Constraints for applyConstraints — NEVER sampleRate (R2).
 */
export function buildComposerMicApplyConstraints() {
  return {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  }
}

/**
 * R3b meta for silence / empty errors.
 */
export function silenceErrorMeta(blob, deviceLabel) {
  return {
    blobSize: blob && typeof blob.size === 'number' ? blob.size : 0,
    deviceLabel: deviceLabel != null ? String(deviceLabel) : '',
  }
}
